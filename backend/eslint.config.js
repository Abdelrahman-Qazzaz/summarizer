import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";
import directoryImportBoundary from "./eslint-rules/directoryImportBoundary.js";
import helperImportOwner from "./eslint-rules/helperImportOwner.js";
import publicModuleEntry from "./eslint-rules/publicModuleEntry.js";

const apiDirectory = fileURLToPath(new URL("./api", import.meta.url));
const messageQueueDirectory = fileURLToPath(
  new URL("./shared/message-queue", import.meta.url),
);
const transcribeWorkerDirectory = fileURLToPath(
  new URL("./transcribe-worker", import.meta.url),
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
    {
      group: ["**/data/*.data"],
      message:
        "Import { data } from shared/data and call data.<table>.<operation>(), so the call reads as a database operation.",
    },
    {
      group: ["**/storage/core"],
      message:
        "storage/core is internal to storage/. Import bucket or sign instead.",
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
          "directory-import-boundary": directoryImportBoundary,
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
      "local/directory-import-boundary": [
        "error",
        { directories: [apiDirectory, transcribeWorkerDirectory] },
      ],
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
    files: ["shared/**/*.data.ts"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-restricted-imports": "off",
      // A data module may sign URLs, which changes nothing in storage, but
      // nothing else in storage/. Types are fine: they can't call anything.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/storage/*", "!**/storage/sign"],
              allowTypeImports: true,
              message:
                "A *.data.ts module may only use storage/sign. Do other storage work in the caller, after the database work.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.data.ts"],
    ignores: ["shared/**/*.data.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message: "Data modules must live under backend/shared.",
        },
      ],
    },
  },
]);
