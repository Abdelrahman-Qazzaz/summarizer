import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";

type PreparationMetric = {
  requestId: string;
  conversationId: string;
  promiseAllId: string;
  operation: string;
  outcome: "fulfilled" | "rejected";
  durationMs: number;
  startOffsetMs: number;
  completedAfterMs: number;
  dependsOn?: string;
};

type HappyPathResult = {
  label: string;
  conversationId?: string;
};

const [logPath, resultsPath, outputPath] = process.argv.slice(2);
assert(
  logPath && resultsPath && outputPath,
  "Usage: summarizePreparationMetrics.ts <api.log> <happy-results.json> <output.json>",
);

const [logContents, resultsContents] = await Promise.all([
  readFile(logPath, "utf8"),
  readFile(resultsPath, "utf8"),
]);
const { results } = JSON.parse(resultsContents) as {
  results: HappyPathResult[];
};
const scenariosByConversation = new Map<string, string[]>();
for (const result of results) {
  if (!result.conversationId) continue;
  const scenarios = scenariosByConversation.get(result.conversationId) ?? [];
  scenarios.push(result.label);
  scenariosByConversation.set(result.conversationId, scenarios);
}

const groups = new Map<string, PreparationMetric[]>();
for (const rawLine of logContents.split("\n")) {
  const line = stripVTControlCharacters(rawLine);
  if (!line.includes("Message preparation operation completed")) continue;
  const metric = JSON.parse(line.slice(line.indexOf("{"))) as PreparationMetric;
  if (!scenariosByConversation.has(metric.conversationId)) continue;
  assert(metric.promiseAllId, "Preparation log is missing promiseAllId");
  assert(Number.isFinite(metric.durationMs) && metric.durationMs >= 0);
  const group = groups.get(metric.promiseAllId) ?? [];
  group.push(metric);
  groups.set(metric.promiseAllId, group);
}

const summaries = [...groups.entries()].map(([promiseAllId, metrics]) => {
  metrics.sort((first, second) => second.durationMs - first.durationMs);
  const slowest = metrics[0]!;
  const scenario = scenariosByConversation.get(slowest.conversationId)?.shift();
  assert(scenario, "No matching happy-path scenario for preparation group");
  assert(metrics.every((metric) => metric.requestId === slowest.requestId));
  assert.equal(
    new Set(metrics.map((metric) => metric.operation)).size,
    metrics.length,
  );
  return {
    scenario,
    durationMs: slowest.durationMs,
    bottleneck: slowest.operation,
    promiseAllId,
    requestId: slowest.requestId,
    conversationId: slowest.conversationId,
    outcome: metrics.some((metric) => metric.outcome === "rejected")
      ? "rejected"
      : "fulfilled",
    operations: metrics.map((metric) => ({
      operation: metric.operation,
      durationMs: metric.durationMs,
      outcome: metric.outcome,
      dependsOn: metric.dependsOn,
      startOffsetMs: metric.startOffsetMs,
      completedAfterMs: metric.completedAfterMs,
    })),
  };
});
assert(summaries.length > 0, "No matching preparation logs found");
assert(
  [...scenariosByConversation.values()].every(
    (scenarios) => scenarios.length === 0,
  ),
);
summaries.sort((first, second) => second.durationMs - first.durationMs);
await writeFile(outputPath, `${JSON.stringify(summaries, null, 2)}\n`);
console.log(
  `Wrote ${summaries.length} Promise.all groups, slowest first, to ${outputPath}`,
);
