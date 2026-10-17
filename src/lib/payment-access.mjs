import { credentialSessionVersion, sessionFromRequest } from "./auth-local.js";
import { currentStaffSession } from "./security-policy.cjs";
import { PaymentRequestError } from "./payment-request.mjs";

export async function authorizePaymentAccess(request, client) {
  const config = await client.restaurantConfig.findFirst({
    select: { authEnabled: true, accessPasswordHash: true },
  });
  if (!config?.authEnabled || !config.accessPasswordHash) return null;
  const session = await currentStaffSession(
    sessionFromRequest(request),
    (id) =>
      client.staffUser.findUnique({
        where: { id },
        select: { id: true, role: true, isActive: true, updatedAt: true },
      }),
    credentialSessionVersion(config.accessPasswordHash)
  );
  if (!session) throw new PaymentRequestError(401, "session-required", "Oturum gerekli.");
  if (!["ADMIN", "CASHIER"].includes(session.role)) {
    throw new PaymentRequestError(403, "forbidden", "Ödeme ve fiş işlemi rolünüz için açık değil.");
  }
  return session;
}
