const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { releaseFiles, sourceHash } = require("./release-files.cjs");
const { checkRelease } = require("./check-release.cjs");

const root = path.resolve(__dirname, "..");
const evidence = JSON.parse(
  fs.readFileSync(path.join(root, ".tepsy", "qa", "release-latest.json"), "utf8")
);
const errors = checkRelease(root);
if (errors.length) throw new Error(errors.join("\n"));
if (!evidence.passed || evidence.sourceHash !== sourceHash(root))
  throw new Error("Current source needs a successful npm run verify:release before packaging.");
const version = require("../package.json").version;
const name = `TEPSY-${version}-${evidence.sourceHash.slice(0, 8)}`;
const destination = path.join(root, "dist", name);
if (fs.existsSync(destination)) throw new Error(`Package already exists: ${destination}`);
fs.mkdirSync(destination, { recursive: true });
const manifest = {
  product: "TEPSY",
  version,
  verifiedAt: evidence.completedAt,
  sourceHash: evidence.sourceHash,
  files: [],
};
for (const file of releaseFiles(root)) {
  const content = fs.readFileSync(path.join(root, file));
  const target = path.join(destination, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  manifest.files.push({
    path: file,
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  });
}
fs.mkdirSync(path.join(destination, "public"), { recursive: true });
fs.writeFileSync(
  path.join(destination, "RELEASE-MANIFEST.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);
fs.writeFileSync(
  path.join(destination, "RELEASE-VERIFICATION.json"),
  JSON.stringify(evidence, null, 2) + "\n"
);
const archive = destination + ".zip";
const compress =
  process.platform === "win32"
    ? [
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:TEPSY_PACKAGE_SOURCE, $env:TEPSY_PACKAGE_ARCHIVE)",
        ],
      ]
    : [
        "python3",
        [
          "-c",
          'import os, pathlib, zipfile; p=pathlib.Path(os.environ["TEPSY_PACKAGE_SOURCE"]); z=zipfile.ZipFile(os.environ["TEPSY_PACKAGE_ARCHIVE"],"w",zipfile.ZIP_DEFLATED); [z.write(f,f.relative_to(p)) for f in sorted(p.rglob("*")) if f.is_file()]; z.close()',
        ],
      ];
const compressed = spawnSync(...compress, {
  env: { ...process.env, TEPSY_PACKAGE_SOURCE: destination, TEPSY_PACKAGE_ARCHIVE: archive },
  encoding: "utf8",
  windowsHide: true,
});
if (compressed.error || compressed.status !== 0)
  throw compressed.error || new Error(compressed.stderr);
const hash = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
fs.writeFileSync(archive + ".sha256", `${hash}  ${path.basename(archive)}\n`);
console.log(`Release folder: ${destination}\nRelease ZIP: ${archive}\nSHA256: ${hash}`);
