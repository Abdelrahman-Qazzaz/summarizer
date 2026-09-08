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
  timeToFirstTokenMs?: number;
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
const scenariosByConversation = new Map<string, HappyPathResult[]>();
for (const result of results) {
  if (!result.conversationId) continue;
  const scenarios = scenariosByConversation.get(result.conversationId) ?? [];
  scenarios.push(result);
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
  assert(metrics.every((metric) => metric.requestId === slowest.requestId));
  assert.equal(
    new Set(metrics.map((metric) => metric.operation)).size,
    metrics.length,
  );
  return {
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
const groupsByRequest = new Map<string, typeof summaries>();
for (const summary of summaries) {
  const requestGroups = groupsByRequest.get(summary.requestId) ?? [];
  requestGroups.push(summary);
  groupsByRequest.set(summary.requestId, requestGroups);
}
const requests = [...groupsByRequest.entries()].map(
  ([requestId, requestGroups]) => {
    requestGroups.sort((first, second) => second.durationMs - first.durationMs);
    const conversationId = requestGroups[0]!.conversationId;
    const scenario = scenariosByConversation.get(conversationId)?.shift();
    assert(scenario, "No matching happy-path scenario for request");
    const timeToFirstTokenMs = scenario.timeToFirstTokenMs;
    assert(
      typeof timeToFirstTokenMs === "number" &&
        Number.isFinite(timeToFirstTokenMs) &&
        timeToFirstTokenMs >= 0,
      "Happy-path results must measure timeToFirstTokenMs from the live stream",
    );
    return {
      scenario: scenario.label,
      timeToFirstTokenMs,
      requestId,
      conversationId,
      preparationGroups: requestGroups.map(
        ({
          requestId: _requestId,
          conversationId: _conversationId,
          ...group
        }) => group,
      ),
    };
  },
);
assert(
  [...scenariosByConversation.values()].every(
    (scenarios) => scenarios.length === 0,
  ),
);
requests.sort(
  (first, second) => second.timeToFirstTokenMs - first.timeToFirstTokenMs,
);
await writeFile(outputPath, `${JSON.stringify(requests, null, 2)}\n`);
console.log(
  `Wrote ${requests.length} requests, longest time to first token first, to ${outputPath}`,
);
