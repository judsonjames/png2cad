import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Dependencies point one way: core knows nothing of files, the DOM or React, and the UI knows no geometry.
const noApp = { group: ["react", "react-dom", "three", "three/*"], message: "The engine stays free of the interface." };
const noEngine = { group: ["@png2cad/core", "@png2cad/formats"], message: "UI components take data through props." };

export default defineConfig([
  globalIgnores(["**/dist/**", "**/coverage/**", "skill/**", "**/test-results/**", "**/playwright-report/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  { files: ["apps/web/src/**/*.tsx", "packages/ui/**/*.tsx"], extends: [reactHooks.configs.flat.recommended] },
  {
    files: ["packages/core/src/**", "packages/formats/src/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [noApp] }] },
  },
  { files: ["packages/ui/src/**"], rules: { "no-restricted-imports": ["error", { patterns: [noEngine] }] } },
  { files: ["apps/cli/**", "**/test/**", "scripts/**"], languageOptions: { globals: globals.node } },
]);
