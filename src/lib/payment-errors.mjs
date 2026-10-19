export class PaymentRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "PaymentRequestError";
    this.status = status;
    this.code = code;
  }
}
