import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";
import helperImportOwner from "./eslint-rules/helperImportOwner.js";
import publicModuleEntry from "./eslint-rules/publicModuleEntry.js";

const messageQueueDirectory = fileURLToPath(
  new URL("./shared/message-queue", import.meta.url),
);

/**
 * Deliberately narrow: this lints module boundaries only, and does not extend
 * the recommended rulesets. Adding those is a separate decision.
 */
const dbClientRestriction = {
  patterns: [
    {
      group: ["**/shared/db"],
      importNames: ["db"],
      message:
        "Table access belongs in a *.data.ts module — import a function from one instead of the db client. Schema imports (tables, enums, pingDb) are fine.",
    },
  ],
};

export default defineConfig([
  globalIgnores(["node_modules", "dist", "test"]),
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    plugins: {
      local: {
        rules: {
          "helper-import-owner": helperImportOwner,
          "public-module-entry": publicModuleEntry,
        },
      },
    },
    linterOptions: {
      // Migrating a file means deleting its disable comment; this is what
      // fails the ones left behind.
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "no-restricted-imports": ["error", dbClientRestriction],
      "local/helper-import-owner": "error",
      "local/public-module-entry": [
        "error",
        {
          directory: messageQueueDirectory,
          entry: "messageQueue",
        },
      ],
    },
  },
  {
    files: ["**/*.data.ts"],
    rules: { "no-restricted-imports": "off" },
  },
]);
