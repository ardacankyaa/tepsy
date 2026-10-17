import { readRequestJson } from "./request-json.mjs";

export function readAuthenticationBody(request) {
  return readRequestJson(request, { maxBytes: 16 * 1024, code: "invalid-auth-body" });
}
