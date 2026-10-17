const { isIP } = require("node:net");

function isAllowedRequestHost(value, allowedHosts = []) {
  if (typeof value !== "string" || !value || value.length > 255 || /[\s/@?#\\]/.test(value))
    return false;
  let parsed;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    return false;
  }
  if (parsed.host.toLowerCase() !== value.toLowerCase()) return false;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    hostname === "localhost" ||
    isIP(hostname) !== 0 ||
    allowedHosts.some((allowed) => allowed.toLowerCase() === value.toLowerCase())
  );
}

module.exports = { isAllowedRequestHost };
