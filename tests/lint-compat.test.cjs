const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("Next syntax rules remain enforced by the current ESLint runtime", async () => {
  const { ESLint } = await import("eslint");
  const lint = new ESLint({ cwd: path.resolve(__dirname, "..") });
  for (const [rule, source, filename] of [
    ["no-head-element", "export default function Page(){return <head />;}", "src/pages/example.js"],
    [
      "no-document-import-in-page",
      'import Document from "next/document"; export default Document;',
      "src/pages/example.js",
    ],
    [
      "no-assign-module-variable",
      "export default function Page(){const module = {}; return module;}",
      "src/pages/example.js",
    ],
    [
      "no-duplicate-head",
      'import Document, { Head } from "next/document"; export default class Page extends Document {render(){return <html><Head/><Head/></html>;}}',
      "src/pages/_document.js",
    ],
  ]) {
    const [result] = await lint.lintText(source, { filePath: filename });
    assert.ok(
      result.messages.some((message) => message.ruleId === "@next/next/" + rule),
      rule + ": " + JSON.stringify(result.messages)
    );
  }
});
