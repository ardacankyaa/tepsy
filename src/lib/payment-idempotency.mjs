import { PaymentRequestError } from "./payment-request.mjs";

export async function readIdempotentPaymentResponse(client, parsed) {
  const attempt = await client.paymentAttempt.findUnique({
    where: { idempotencyKey: parsed.idempotencyKey },
  });
  if (!attempt) return null;
  if (attempt.requestFingerprint !== parsed.requestFingerprint) {
    throw new PaymentRequestError(
      409,
      "idempotency-conflict",
      "Ödeme anahtarı başka bir istek için kullanılmış."
    );
  }
  try {
    return JSON.parse(attempt.responseJson);
  } catch {
    throw new Error("Stored payment response is not valid JSON.");
  }
}

export async function executeIdempotentPayment(client, parsed, createPaymentResponse) {
  const existing = await readIdempotentPaymentResponse(client, parsed);
  if (existing) return { response: existing, isReplay: true };

  const response = await createPaymentResponse(client);
  await client.paymentAttempt.create({
    data: {
      idempotencyKey: parsed.idempotencyKey,
      requestFingerprint: parsed.requestFingerprint,
      responseJson: JSON.stringify(response),
    },
  });
  return { response, isReplay: false };
}
