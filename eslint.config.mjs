import js from "@eslint/js";
import globals from "globals";
import hooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";
import { fixupPluginRules } from "@eslint/compat";

export default [
  { ignores: ["node_modules/**", ".next/**", ".restopos/**", ".tepsy/**", "dist/**", "docs/**"] },
  {
    files: [
      "src/**/*.{js,jsx,mjs,cjs}",
      "server.js",
      "scripts/*.{js,mjs,cjs}",
      "prisma/*.js",
      "tests/**/*.{mjs,cjs}",
      "*.{js,mjs}",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },
  {
    files: ["**/*.cjs", "server.js", "scripts/*.js", "prisma/*.js", "postcss.config.js"],
    languageOptions: { sourceType: "commonjs" },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { "react-hooks": hooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    // Keep these four syntax checks; package.json swaps the plugin's fast-glob (unpatched braces) for tinyglobby.
    plugins: { "@next/next": fixupPluginRules(next) },
    rules: {
      "@next/next/no-head-element": "error",
      "@next/next/no-duplicate-head": "error",
      "@next/next/no-assign-module-variable": "error",
      "@next/next/no-document-import-in-page": "error",
    },
  },
];
