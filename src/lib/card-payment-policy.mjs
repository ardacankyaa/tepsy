import { PaymentRequestError } from "./payment-request.mjs";

// A reachable device is not bank authorization. Until an adapter supports
// durable, reconciled payment attempts, integrated card payments fail closed.
export function assertCardPaymentAllowed(payment, terminal) {
  if (payment.paymentMethod !== "CREDIT_CARD") return null;
  if (!terminal || typeof terminal.enabled !== "boolean") {
    throw new PaymentRequestError(
      503,
      "terminal-config-unavailable",
      "Terminal ayarı doğrulanamadı; ödeme kaydedilmedi."
    );
  }
  // TokenX exports the basket only. It still requires explicit external-payment confirmation.
  if (terminal.enabled && !["MANUAL", "TOKENX_CLOUD"].includes(terminal.adapter)) {
    throw new PaymentRequestError(
      503,
      "terminal-payment-unavailable",
      "Terminalden banka onayı alınamadı. Mevcut terminal adaptörü tahsilatı desteklemiyor; ödeme kaydedilmedi. POS bağlantısı olmadan çalışmak için yönetici cihaz ayarlarından manuel ödeme kaydını seçebilir."
    );
  }
  if (payment.manualCardConfirmed !== true) {
    const error = new PaymentRequestError(
      409,
      "manual-card-confirmation-required",
      "Kart tahsilatını ayrıca yaptığınızı onaylayın. Bu işlem yalnızca manuel ödeme kaydı oluşturur; karttan para çekmez."
    );
    error.terminalBasketTransferRequired = terminal.enabled && terminal.adapter === "TOKENX_CLOUD";
    throw error;
  }
  return "MANUAL";
}
