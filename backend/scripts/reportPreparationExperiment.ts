import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

type Operation = {
  operation: string;
  durationMs: number;
  outcome: string;
  startOffsetMs: number;
  completedAfterMs: number;
  imageCount?: number;
  urlsToSign?: number;
  operations?: Operation[];
  preparationGroups?: { durationMs: number; operations: Operation[] }[];
};
type RequestMetric = {
  scenario: string;
  timeToFirstTokenMs: number;
  serverTimings: {
    modelStartedAfterMs: number;
    modelTimeToFirstTokenMs: number;
  };
  preparationGroups: { durationMs: number; operations: Operation[] }[];
};
const folder = new URL("../../output/preparation-metrics/", import.meta.url);
async function readJson(name: string) {
  return JSON.parse(await readFile(new URL(name, folder), "utf8"));
}
const baseline: RequestMetric[] = await readJson("valid-baseline-metrics.json");
const optimized: RequestMetric[] = await readJson(
  "valid-optimized-metrics.json",
);
const benchmark = await readJson("reservation-benchmark.json");

function allOperations(level: {
  operations?: Operation[];
  preparationGroups?: { durationMs: number; operations: Operation[] }[];
}): Operation[] {
  const operations = level.operations ?? [];
  for (const group of level.preparationGroups ?? []) {
    assert.equal(
      group.durationMs,
      Math.max(...group.operations.map((operation) => operation.durationMs)),
    );
  }
  return [
    ...operations,
    ...operations.flatMap(allOperations),
    ...(level.preparationGroups ?? []).flatMap(allOperations),
  ];
}
for (const [name, metrics] of [
  ["valid-baseline", baseline],
  ["valid-optimized", optimized],
] as const) {
  const result = await readJson(`${name}-results.json`);
  assert.equal(result.results.length, 9);
  assert(
    result.results.every(
      (entry: { status: string }) => entry.status === "passed",
    ),
  );
  assert(
    result.cleanup.every((entry: { status: number }) => entry.status === 200),
  );
  assert.equal(metrics.length, 8);
  for (const request of metrics) {
    const operations = allOperations(request);
    assert(operations.every((operation) => operation.outcome === "fulfilled"));
    const claim = operations.find(
      (operation) => operation.operation === "claimConversationTurn",
    )!;
    const reservation = operations.find(
      (operation) => operation.operation === "reserveAttachments",
    )!;
    assert(reservation.startOffsetMs < claim.completedAfterMs);
    if (request.scenario === "two screenshots") {
      assert(
        operations.some(
          (operation) =>
            operation.operation === "imageUrls.resolve" &&
            operation.imageCount === 2,
        ),
      );
    }
    if (request.scenario === "image history with expired URLs") {
      assert(
        operations.some(
          (operation) =>
            operation.operation === "bucket.createSignedUrls" &&
            operation.imageCount === 2,
        ),
      );
    }
  }
}
const optimizedByScenario = new Map(
  optimized.map((request) => [request.scenario, request]),
);
const seconds = (milliseconds: number) =>
  `${(milliseconds / 1000).toFixed(3)} s`;
const table = [...baseline]
  .sort(
    (a, b) =>
      b.serverTimings.modelStartedAfterMs - a.serverTimings.modelStartedAfterMs,
  )
  .map((previous) => {
    const current = optimizedByScenario.get(previous.scenario)!;
    return `| ${previous.scenario} | ${seconds(previous.serverTimings.modelStartedAfterMs)} | ${seconds(current.serverTimings.modelStartedAfterMs)} | ${seconds(previous.timeToFirstTokenMs)} | ${seconds(current.timeToFirstTokenMs)} |`;
  });
const text = [
  "# Database preparation experiment",
  "",
  "Baseline: a78617c, with the combined history query restored. Candidate: branch perf/db-preparation-investigation in /tmp/summarizer-db-perf. Main is unchanged. These are local API tests against the configured remote development services, not production latency measurements.",
  "",
  "Both corrected E2E runs passed all 9 checks: 8 chat requests and real audio transcription. Each chat checked HTTP/SSE success, first nonempty token, complete stream, and persisted message contents and attachment counts. Both screenshot fixtures were required. The expired-URL scenario confirmed an actual two-image bucket signing call. YouTube was skipped.",
  "",
  "## What worked",
  "",
  "The single-statement reservation cut the repeated benchmark median from 1673.52 ms to 553.87 ms, a 1119.65 ms reduction, about 67%. Six samples of each implementation alternated order on the same fixtures and warmed pool. Each sample verified two reservations and released its own token afterward.",
  "",
  "The old transaction sends BEGIN, a locking SELECT, INSERT, and COMMIT. The parameterized SELECT and INSERT each require a parameter-description exchange with this driver configuration. The replacement locks the same owned attachment rows in sorted order, checks that all requested IDs exist, and inserts all reservations in one atomic statement. It preserves independent, parallel conversation claims and attachment reservations.",
  "",
  "Pool warming moves initial connection setup into startup. The API now opens five connections during preflight. It does not remove warm query latency, guarantee that five connections cover concurrent users, or prevent future connection replacement. Every API process keeps those extra idle connections, so deployment replica count must be considered when sizing the pool.",
  "",
  "Disabling automatic type discovery avoided one catalog query per new connection. The initial cold benchmark showed about 245 ms less startup wait. This is a small-sample result. The current schema does not use SQL array columns, and the live image/transcript/history paths passed with discovery disabled. Revisit this option if code starts depending on automatic array/custom-type decoding.",
  "",
  "## Corrected end-to-end comparison",
  "",
  "Preparation below means handler entry to the start of the model call, matching the earlier report's Before model column. Client TTFT means request dispatch to the first nonempty SSE delta. It includes preparation, model wait, middleware and delivery. One sample per scenario is not a reliable estimate of model latency or production speedup.",
  "",
  "| Scenario | Baseline preparation | Candidate preparation | Baseline client TTFT | Candidate client TTFT |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...table,
  "",
  "The combination of changes is measured here. The full E2E comparison does not separately attribute savings to each connection option. The alternating reservation benchmark isolates that change more directly.",
  "",
  "## What did not work, and corrections",
  "",
  "- Direct TLS negotiation was inactive: the effective SSL option for this test endpoint is false. The earlier claimed improvement was timing noise. The option was removed from the candidate.",
  "- Limiting the pool to one connection made the initial five-query batch slower in the exploratory benchmark. It is not part of the candidate.",
  "- The first three worktree E2E runs omitted screenshot files and accepted an empty image list. Their image, mixed-image, and expired-URL results are invalid. The old reverted-baseline, connection-options and warm-pool JSON files are retained for the audit trail only. Use the valid-baseline and valid-optimized files below.",
  "- The first reservation SQL draft had qualified INSERT column names, then a raw Date serialization error. Both were fixed before the successful integration and corrected E2E tests.",
  "",
  "## Remaining cost",
  "",
  "The warm diagnostic median was 280.35 ms for an unparameterized query and 559.35 ms for a parameterized query. The installed PostgreSQL.js driver describes parameters before execution when prepare is false. This explains a two-round-trip latency floor. Prepared statements were kept disabled for compatibility with the configured pooler. The endpoint carries the ap-northeast-1 region label; check actual production API/database placement before assuming these local-to-remote timings apply there.",
  "",
  "SQL CPU execution was already small in the earlier history EXPLAIN. Reducing redundant round trips is the next useful target. Provider wait remains variable and includes provider-side image retrieval, which this API cannot measure separately.",
  "",
  "## Validation and files",
  "",
  "74 focused tests passed, including 10 tests on a disposable local PostgreSQL instance. These cover ownership, all-or-none reservation, both delete/reserve lock orderings, duplicate IDs, expiry, reversed concurrent ID order, rollback and release. Backend typecheck, lint and build passed.",
  "",
  "Cleanup verified: the five E2E fixture users have no remaining conversations, attachments or storage objects and were deleted. The reservation benchmark removed its own fixture user. The failed remote integration-test schema was removed. The API, worker and both disposable containers were stopped.",
  "",
  "- [Candidate metrics, sorted by client TTFT](valid-optimized-metrics.json)",
  "- [Baseline metrics](valid-baseline-metrics.json)",
  "- [Repeated reservation benchmark](reservation-benchmark.json)",
  "- [Candidate E2E results](valid-optimized-results.json)",
  "- [Baseline E2E results](valid-baseline-results.json)",
  "",
];
assert.equal(
  benchmark.summaries.find(
    (summary: { operation: string }) => summary.operation === "transaction",
  ).samples,
  6,
);
await writeFile(
  new URL("performance-investigation-report.md", folder),
  text.join("\n"),
);
console.log(table.join("\n"));
