import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { buildTokenXBasket, createTokenXClient, transferError } from "./tokenx.mjs";
import { openTransferStore } from "./terminal-transfer-store.mjs";

export async function loadTransferAccount(client, parsed) {
  const where = parsed.orderId
    ? { id: parsed.orderId }
    : { tableId: parsed.tableId, status: { in: ["PENDING", "PREPARING", "READY", "DELIVERED"] } };
  const orders = await client.order.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      table: true,
      items: { include: { menuItem: { include: { category: true } } } },
      payments: true,
    },
  });
  const restaurant = await client.restaurantConfig.findFirst({ select: { currency: true } });
  return { orders, restaurant };
}

function withIdentity(built, identity) {
  return createHash("sha256").update(`${identity}\0${built.fingerprint}`).digest("hex");
}

export function transferStorePath(deviceConfigPath) {
  return path.join(path.dirname(deviceConfigPath), "terminal-transfers.db");
}

export async function sendTokenXAccount({
  account,
  parsed,
  terminal,
  filename,
  provider = createTokenXClient(),
}) {
  const fiscal = await provider.getFiscal(terminal.terminalId);
  const built = buildTokenXBasket({ ...account, parsed, terminal, fiscal, basketID: randomUUID() });
  const store = openTransferStore(filename);
  try {
    const { transfer, isNew } = store.reserve({
      ...built,
      fingerprint: withIdentity(built, provider.identity),
      orderIds: account.orders.map((order) => order.id),
      terminalId: terminal.terminalId,
      fiscal,
      identity: provider.identity,
    });
    if (Date.now() - transfer.createdAt >= 72 * 60 * 60 * 1000)
      throw transferError(
        "terminal-transfer-expired",
        "Aktarım kaydı üç günden eski. Cihazdaki adisyon kontrol edilmeden yeni sepet gönderilmez."
      );
    if (!isNew && transfer.state === "SENT")
      return { basketID: transfer.basket.basketID, isReplay: true };
    if (!isNew) {
      if (Date.now() - transfer.createdAt < 30000)
        throw transferError(
          "terminal-transfer-pending",
          "Adisyon aktarımı sürüyor veya yanıtı belirsiz. Cihazı kontrol edip biraz sonra yeniden deneyin."
        );
      // Reconcile the existing UUID, never retry a creation after an uncertain response.
      const remote = await provider.getBasket(terminal.terminalId, transfer.basket.basketID);
      if (
        !remote ||
        remote.basketID !== transfer.basket.basketID ||
        remote.deletedAt ||
        remote.total !== transfer.totalCents ||
        JSON.stringify(
          (remote.items || []).map(({ name, price, sectionNo, taxPercent, quantity }) => ({
            name,
            price,
            sectionNo,
            taxPercent,
            quantity,
          }))
        ) !==
          JSON.stringify(
            transfer.basket.items.map(({ name, price, sectionNo, taxPercent, quantity }) => ({
              name,
              price,
              sectionNo,
              taxPercent,
              quantity,
            }))
          )
      )
        throw transferError(
          "terminal-transfer-unresolved",
          "Önceki aktarım sağlayıcıdan doğrulanamadı. Yeni sepet gönderilmedi; cihaz ve aktarım kaydı kontrol edilmelidir."
        );
      store.mark(transfer.basket.basketID, "SENT");
      return { basketID: transfer.basket.basketID, isReplay: true };
    }
    try {
      await provider.sendBasket(terminal.terminalId, transfer.basket);
      store.mark(transfer.basket.basketID, "SENT");
    } catch (error) {
      store.mark(transfer.basket.basketID, "UNKNOWN");
      throw error;
    }
    return { basketID: transfer.basket.basketID, isReplay: false };
  } finally {
    store.close();
  }
}

export async function assertTokenXTransferCurrent(client, parsed, terminal, filename) {
  const account = await loadTransferAccount(client, parsed);
  const store = openTransferStore(filename);
  try {
    const transfer = store.readForOrders(account.orders.map((order) => order.id));
    if (
      !transfer ||
      transfer.state !== "SENT" ||
      Date.now() - transfer.createdAt >= 72 * 60 * 60 * 1000
    )
      throw transferError(
        "terminal-transfer-required",
        "Kart kaydından önce adisyon terminale aktarılmalıdır."
      );
    const provider = createTokenXClient();
    const built = buildTokenXBasket({
      ...account,
      parsed,
      terminal,
      fiscal: transfer.fiscal,
      basketID: transfer.basket.basketID,
    });
    if (
      withIdentity(built, provider.identity) !== transfer.fingerprint ||
      JSON.stringify([...transfer.orderIds].sort()) !==
        JSON.stringify(account.orders.map((order) => order.id).sort())
    )
      throw transferError(
        "terminal-account-changed",
        "Adisyon terminale aktarıldıktan sonra değişmiş. Ödeme kaydedilmedi; cihazdaki tutarı kontrol edin."
      );
  } finally {
    store.close();
  }
}
