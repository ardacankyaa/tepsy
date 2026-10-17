const { isIP } = require("node:net");

function isLoopbackIPv4(address) {
  return isIP(address) === 4 && Number(address.split(".")[0]) === 127;
}

function isLoopbackAddress(remoteAddress) {
  const address = String(remoteAddress || "").toLowerCase();
  if (isLoopbackIPv4(address)) return true;
  if (isIP(address) !== 6) return false;
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;

  const mappedIPv4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  return Boolean(mappedIPv4 && isLoopbackIPv4(mappedIPv4));
}

function canAccessInitialSetup(config, remoteAddress) {
  return Boolean(config?.isSetupCompleted || isLoopbackAddress(remoteAddress));
}

function canRunSetup(state) {
  return (
    !state.isSetupCompleted &&
    !state.hasAccessPassword &&
    ["tables", "orders", "payments", "staff", "categories"].every((key) => state[key] === 0)
  );
}

module.exports = { canAccessInitialSetup, canRunSetup, isLoopbackAddress };
