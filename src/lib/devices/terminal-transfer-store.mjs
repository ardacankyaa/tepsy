import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { transferError } from "./tokenx.mjs";

// Separate durable outbox; never migrates or modifies the restaurant database.
export function openTransferStore(filename) {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS Transfer (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS TransferOrder (orderId TEXT PRIMARY KEY, transferId TEXT NOT NULL REFERENCES Transfer(id));`);
  function readForOrders(orderIds) {
    const ids = [...new Set(orderIds)];
    if (!ids.length) return null;
    const rows = db
      .prepare(
        `SELECT DISTINCT t.* FROM Transfer t JOIN TransferOrder o ON o.transferId=t.id WHERE o.orderId IN (${ids.map(() => "?").join(",")})`
      )
      .all(...ids);
    if (!rows.length) return null;
    if (rows.length !== 1)
      throw transferError(
        "terminal-account-changed",
        "Bu adisyonda farklı terminal aktarımlarına ait siparişler var. Cihazdaki adisyonları kontrol edin."
      );
    return { ...JSON.parse(rows[0].payload), state: rows[0].state, createdAt: rows[0].createdAt };
  }
  return {
    readForOrders,
    reserve(input) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = readForOrders(input.orderIds);
        if (existing) {
          if (
            existing.fingerprint !== input.fingerprint ||
            JSON.stringify([...existing.orderIds].sort()) !==
              JSON.stringify([...input.orderIds].sort())
          )
            throw transferError(
              "terminal-account-changed",
              "Adisyon önceki terminal aktarımından sonra değişmiş. Yeni sepet oluşturulmadı; cihazdaki adisyonu kontrol edin."
            );
          db.exec("COMMIT");
          return { transfer: existing, isNew: false };
        }
        const createdAt = Date.now();
        db.prepare("INSERT INTO Transfer VALUES (?,?,?,?,?)").run(
          input.basket.basketID,
          input.fingerprint,
          JSON.stringify(input),
          "PENDING",
          createdAt
        );
        const insert = db.prepare("INSERT INTO TransferOrder VALUES (?,?)");
        for (const orderId of input.orderIds) insert.run(orderId, input.basket.basketID);
        db.exec("COMMIT");
        return { transfer: { ...input, state: "PENDING", createdAt }, isNew: true };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    mark(id, state) {
      if (!["SENT", "UNKNOWN"].includes(state)) throw new Error("Invalid transfer state");
      db.prepare("UPDATE Transfer SET state=? WHERE id=?").run(state, id);
    },
    close() {
      db.close();
    },
  };
}
