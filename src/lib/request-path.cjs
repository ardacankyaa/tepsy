// Next.js decodes percent-encoded request paths before routing. Access rules must be
// evaluated on the same decoded path, and spellings that a router could interpret
// differently (encoded separators, dot segments, repeated slashes) are refused.

function rawRequestPath(target) {
  const value = String(target ?? "");
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
}

function canonicalRequestPath(target) {
  const raw = rawRequestPath(target);
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.length > 4096) return null;
  if (raw.includes("\\")) return null;
  // Malformed escapes and encoded path separators or NUL bytes.
  if (/%(?![0-9a-f]{2})/i.test(raw) || /%(?:2f|5c|00)/i.test(raw)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Control characters, backslashes and double-encoded escapes.
  if (/[\\%]/.test(decoded) || [...decoded].some((char) => char < " " || char === "\u007f"))
    return null;
  if (decoded.includes("//")) return null;
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return decoded.length > 1 && decoded.endsWith("/") ? decoded.slice(0, -1) : decoded;
}

// Role rules are written in lower case. Evaluating a lower-cased copy keeps a
// differently cased spelling from falling through to a broader rule.
function policyRequestPath(canonicalPath) {
  return String(canonicalPath).toLowerCase();
}

module.exports = { canonicalRequestPath, policyRequestPath };
