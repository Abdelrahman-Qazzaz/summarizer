/**
 * Bundles the two process entrypoints for production.
 *
 * tsc cannot do this job here: tsconfig.json sets `noEmit` with
 * `allowImportingTsExtensions` (which requires it) and `moduleResolution:
 * "bundler"`, so the source uses extensionless imports Node's ESM loader will
 * not resolve. The code is written for a bundler, so it gets a bundler.
 *
 * `packages: "external"` keeps node_modules out of the bundle — only our own
 * source is inlined. Dependencies stay resolved at runtime from an ordinary
 * `npm ci --omit=dev`, which keeps the output small and avoids bundling
 * packages that do dynamic requires.
 */
import { build } from "esbuild";

const ENTRYPOINTS = {
  api: "api/index.ts",
  "transcribe-worker": "transcribe-worker/index.ts",
  // Operational one-shots, bundled so they can be run from the same image
  // without drizzle-kit (a devDependency) being present at runtime.
  migrate: "scripts/migrate.ts",
  baseline: "scripts/baseline.ts",
} as const;

const results = await Promise.all(
  Object.entries(ENTRYPOINTS).map(([name, entry]) =>
    build({
      entryPoints: { [name]: entry },
      outdir: "dist",
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "external",
      sourcemap: true,
      logLevel: "info",
      // Reported by the bundle rather than inferred, so a build artifact can
      // say which mode it was produced for.
      define: { "process.env.BUILD_TARGET": JSON.stringify("production") },
    }),
  ),
);

const failed = results.filter((result) => result.errors.length > 0);
if (failed.length > 0) process.exit(1);

console.log(`built ${Object.keys(ENTRYPOINTS).join(", ")} into dist/`);
