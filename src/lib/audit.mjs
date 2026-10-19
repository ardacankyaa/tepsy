import { sessionFromRequest } from "./auth-local.js";
export function auditActor(request) {
  const session = sessionFromRequest(request);
  return { actorId: session?.userId || "local", actorName: session?.name || "Yerel yönetici" };
}
export async function recordAudit(client, request, action, entityId, details = {}) {
  return client.auditEvent.create({
    data: { ...auditActor(request), action, entityId, detailsJson: JSON.stringify(details) },
  });
}
