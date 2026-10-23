import { credentialSessionVersion, sessionFromRequest } from "./auth-local.js";
import { currentStaffSession } from "./security-policy.cjs";
import { isLoopbackAddress } from "./setup-policy.cjs";
import { trustedClientAddress } from "./trusted-client.cjs";

const LOCAL_OWNER = Object.freeze({ userId: "owner", role: "ADMIN", local: true });

const deny = (status, error) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

// Defense in depth behind the server.js gateway: restricted handlers verify the
// current staff role themselves, so a routing or path-matching gap cannot expose them.
// Returns { session } when allowed, otherwise { denied } with the response to send.
export async function requireStaffRole(request, client, roles) {
  const config = await client.restaurantConfig.findFirst({
    select: { authEnabled: true, accessPasswordHash: true },
  });
  if (!config?.authEnabled || !config.accessPasswordHash) {
    // Without staff sign-in the gateway admits only the server computer itself.
    return isLoopbackAddress(trustedClientAddress(request))
      ? { session: LOCAL_OWNER }
      : { denied: deny(403, "Forbidden.") };
  }
  const session = await currentStaffSession(
    sessionFromRequest(request),
    (id) =>
      client.staffUser.findUnique({
        where: { id },
        select: { id: true, role: true, isActive: true, updatedAt: true },
      }),
    credentialSessionVersion(config.accessPasswordHash)
  );
  if (!session) return { denied: deny(401, "Authentication required.") };
  if (!roles.includes(session.role)) return { denied: deny(403, "Forbidden.") };
  return { session };
}
