import { createHash } from "node:crypto";
import {
  moneyToCents,
  centsToMoney,
  computeOrderBalance,
  discountToCents,
  basisPointsToPercent,
  discountPercentToBasisPoints,
} from "../finance.mjs";
import { PaymentRequestError } from "../payment-request.mjs";

const OPEN = new Set(["PENDING", "PREPARING", "READY", "DELIVERED"]);
export function transferError(code, message, status = 409) {
  return new PaymentRequestError(status, code, message);
}

export function buildTokenXBasket({ basketID, orders, restaurant, parsed, terminal, fiscal }) {
  if (!["TRY", "₺"].includes(restaurant?.currency))
    throw transferError(
      "terminal-currency",
      "TokenX adisyon aktarımı bu aşamada yalnızca TL destekliyor."
    );
  if (!orders?.length || orders.some((order) => !OPEN.has(order.status)))
    throw transferError("terminal-order-state", "Aktarılacak açık adisyon bulunamadı.");
  if (orders.some((order) => order.payments?.length))
    throw transferError(
      "terminal-partial-payment",
      "İlk aşamada yalnızca henüz tahsilat yapılmamış tam adisyon aktarılabilir."
    );
  if (fiscal?.terminal !== terminal.terminalId || !Array.isArray(fiscal.sections))
    throw transferError("terminal-fiscal-mismatch", "Cihazın mali kısım bilgileri doğrulanamadı.");
  let gross = 0;
  let discount = 0;
  const items = [];
  for (const order of orders) {
    const balance = computeOrderBalance(order);
    gross += balance.grossCents;
    discount += balance.discountCents;
    let itemTotal = 0;
    for (const item of order.items || []) {
      if (item.status === "CANCELLED") continue;
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)
        throw transferError("terminal-quantity", "Ürün miktarı geçersiz.");
      const name = item.menuItemName || item.menuItem?.name;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 100 ||
        Array.from(name).some((character) => character.charCodeAt(0) < 32)
      )
        throw transferError(
          "terminal-item-name",
          "Ürün adı terminale aktarmak için geçersiz veya çok uzun."
        );
      const category = item.menuItemCategoryName || item.menuItem?.category?.name;
      const sectionNo = terminal.categorySections?.find(
        (entry) => entry.category === category
      )?.sectionNo;
      const section = fiscal.sections.find((entry) => entry.sectionNo === sectionNo);
      if (
        !section ||
        !Number.isInteger(section.taxPercent) ||
        section.taxPercent < 0 ||
        section.taxPercent > 10000 ||
        section.status === 0
      )
        throw transferError(
          "terminal-fiscal-mapping",
          `${category || "Kategorisiz"} kategorisinin cihaz kısım eşlemesini kontrol edin.`
        );
      const price = moneyToCents(item.unitPrice);
      itemTotal += price * item.quantity;
      items.push({
        name,
        price,
        sectionNo,
        taxPercent: section.taxPercent,
        quantity: item.quantity * 1000,
        unit: "Adet",
      });
    }
    if (!Number.isSafeInteger(itemTotal) || itemTotal !== balance.grossCents)
      throw transferError(
        "terminal-total-mismatch",
        "Adisyon tutarı ile ürün toplamı eşleşmiyor; aktarım yapılmadı."
      );
  }
  if (!items.length || items.length > 250 || !Number.isSafeInteger(gross))
    throw transferError(
      "terminal-item-count",
      "Bir adisyonda 1 ile 250 arasında ürün kalemi olmalıdır."
    );
  if (parsed.discountPercentBasisPoints > 0) {
    if (discount > 0) {
      if (
        orders.some(
          (order) =>
            discountPercentToBasisPoints(order.discountPercent || "0") !==
              parsed.discountPercentBasisPoints ||
            (String(order.discountReason || "").trim() || null) !== parsed.discountReason
        )
      )
        throw transferError(
          "discount-locked",
          "Adisyonun mevcut indirimi ile seçilen indirim eşleşmiyor."
        );
    } else {
      discount = discountToCents(gross, basisPointsToPercent(parsed.discountPercentBasisPoints));
    }
  }
  const totalCents = gross - discount;
  if (
    totalCents <= 0 ||
    (parsed.requestedAmountCents !== undefined && parsed.requestedAmountCents !== totalCents)
  )
    throw transferError(
      "terminal-partial-payment",
      "Terminale aktarımda adisyonun tamamı seçilmelidir; parçalı tahsilat bu aşamada desteklenmiyor."
    );
  const basket = {
    basketID,
    title: orders[0].table?.tableNumber || "TEPSY",
    filter: orders[0].table?.section || "",
    items,
    ...(discount > 0
      ? {
          adjust: {
            description:
              parsed.discountReason ||
              orders.find((order) => order.discountReason)?.discountReason ||
              "İndirim",
            discountOrSurcharge: 0,
            type: 0,
            value: discount,
          },
        }
      : {}),
  };
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        terminalId: terminal.terminalId,
        orderIds: orders.map((order) => order.id).sort(),
        basket: { ...basket, basketID: undefined },
        total: centsToMoney(totalCents),
      })
    )
    .digest("hex");
  return { basket, fingerprint, totalCents };
}

export function createTokenXClient({ env = process.env, fetchImpl = fetch } = {}) {
  const authUrl = env.TEPSY_TOKENX_AUTH_URL || env.RESTOPOS_TOKENX_AUTH_URL;
  const apiUrl = (env.TEPSY_TOKENX_API_URL || env.RESTOPOS_TOKENX_API_URL || "").replace(/\/$/, "");
  const clientId = env.TEPSY_TOKENX_CLIENT_ID || env.RESTOPOS_TOKENX_CLIENT_ID;
  const clientSecret = env.TEPSY_TOKENX_CLIENT_SECRET || env.RESTOPOS_TOKENX_CLIENT_SECRET;
  if (!authUrl || !apiUrl || !clientId || !clientSecret)
    throw transferError(
      "terminal-credentials-required",
      "TokenX sunucu adresleri ve entegratör kimlik bilgileri sunucunun .env dosyasında tanımlanmalıdır.",
      503
    );
  for (const value of [authUrl, apiUrl]) {
    let url;
    try {
      url = new URL(value);
    } catch {
      /* validated below */
    }
    if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw transferError(
        "terminal-config-invalid",
        "TokenX sunucu adresleri geçerli HTTPS adresleri olmalıdır.",
        503
      );
  }
  let accessToken;
  async function jsonRequest(url, options) {
    let response, body;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
      body = await response.json();
    } catch {
      throw transferError(
        "terminal-response-unknown",
        "TokenX yanıtı doğrulanamadı. Aynı adisyon otomatik olarak tekrar gönderilmedi; cihazdan kontrol edin.",
        503
      );
    }
    if (!response.ok || !body || typeof body !== "object")
      throw transferError(
        "terminal-provider-error",
        "TokenX isteği kabul etmedi. Sağlayıcı ayarlarını ve cihaz durumunu kontrol edin.",
        503
      );
    return body;
  }
  async function request(route, terminalId, method = "GET", body) {
    if (!accessToken) {
      const auth = await jsonRequest(authUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
      });
      if (
        !auth.result?.accessToken ||
        auth.result.tokenType !== "Bearer" ||
        !Number.isFinite(auth.result.expiresIn) ||
        auth.result.expiresIn <= 0
      )
        throw transferError("terminal-auth-failed", "TokenX kimlik doğrulaması başarısız.", 503);
      accessToken = auth.result.accessToken;
    }
    const result = await jsonRequest(`${apiUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "terminal-id": terminalId,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (result.status !== 0)
      throw transferError(
        "terminal-provider-error",
        "TokenX işlemi başarısız; cihazı ve entegratör ayarlarını kontrol edin.",
        503
      );
    return result.result;
  }
  return {
    identity: createHash("sha256").update(`${apiUrl}\0${clientId}`).digest("hex"),
    getFiscal: (id) => request("/fiscal-parameters", id),
    sendBasket: (id, basket) => request("/basket", id, "POST", basket),
    getBasket: (id, basketId) => request(`/basket/${encodeURIComponent(basketId)}`, id),
  };
}
