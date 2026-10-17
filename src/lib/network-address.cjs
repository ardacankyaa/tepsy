const VIRTUAL_INTERFACE =
  /(?:virtual|vmware|hyper-v|vEthernet|wsl|docker|loopback|tailscale|zerotier|vpn|hamachi|virtualbox|wireguard|openvpn|\btap\b|\btun\b)/i;
const PHYSICAL_INTERFACE = /^(?:wi-?fi|wlan|ethernet|eth\d*|en\d*)(?:\s|$)/i;

function parseIPv4(address) {
  const parts = String(address || "")
    .split(".")
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return null;
  return parts;
}

function isPrivateIPv4(parts) {
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function selectLocalIPv4(interfaces) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    for (const iface of Array.isArray(entries) ? entries : []) {
      const family = String(iface?.family || "").toLowerCase();
      const isIPv4 = family === "ipv4" || family === "4";
      const parts = parseIPv4(iface?.address);
      if (!isIPv4 || iface?.internal || !parts || !isPrivateIPv4(parts)) continue;
      candidates.push({
        address: iface.address,
        virtual: VIRTUAL_INTERFACE.test(name),
        physical: PHYSICAL_INTERFACE.test(name),
      });
    }
  }

  candidates.sort((left, right) => {
    if (left.virtual !== right.virtual) return left.virtual ? 1 : -1;
    if (left.physical !== right.physical) return left.physical ? -1 : 1;
    return 0;
  });
  return candidates[0]?.address || "localhost";
}

module.exports = { selectLocalIPv4 };
