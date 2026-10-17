const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { managedPaths } = require("./local-paths.cjs");

try {
  const record = path.join(managedPaths().app, ".tepsy", "production-runtime.json");
  const { host, port } = JSON.parse(fs.readFileSync(record, "utf8"));
  const addresses = new Set();
  for (const network of Object.values(os.networkInterfaces())) {
    for (const address of network || []) {
      if (address.internal || address.address.startsWith("169.254.")) continue;
      const matches =
        host === address.address ||
        (host === "0.0.0.0" && address.family === "IPv4") ||
        (host === "::" && address.family === "IPv6" && !address.scopeid);
      if (!matches) continue;
      const hostname = address.family === "IPv6" ? `[${address.address}]` : address.address;
      addresses.add(`http://${hostname}:${port}`);
    }
  }
  if (addresses.size) {
    console.log("On other devices connected to the same Wi-Fi / local network, open:");
    for (const address of addresses) console.log(`  ${address}`);
    console.log("If blocked, allow Node.js on Private networks in Windows Firewall.");
  } else {
    console.log("No local network address is available for this server.");
    console.log("Check the network connection and TEPSY_BIND_HOST / RESTOPOS_BIND_HOST.");
  }
} catch {
  console.log("Could not read network addresses. TEPSY startup status is shown above.");
}
