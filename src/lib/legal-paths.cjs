const LEGAL_PATHS = new Set(["/privacy", "/terms", "/cookies"]);

function isLegalPath(pathname) {
  return LEGAL_PATHS.has(pathname);
}

module.exports = { isLegalPath };
