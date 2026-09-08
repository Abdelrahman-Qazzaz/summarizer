import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";

type PreparationMetric = {
  requestId: string;
  conversationId: string;
  operationId: string;
  parentOperationId?: string;
  promiseAllId?: string;
  operation: string;
  outcome: "fulfilled" | "rejected";
  durationMs: number;
  startOffsetMs: number;
  completedAfterMs: number;
  imageCount?: number;
  cachedUrlCount?: number;
  urlsToSign?: number;
  transcriptCount?: number;
  querySkipped?: boolean;
};

type FirstTokenMetric = {
  requestId: string;
  conversationId: string;
  modelStartedAfterMs: number;
  modelTimeToFirstTokenMs: number;
  firstTokenAfterMs: number;
};

type HappyPathResult = {
  label: string;
  conversationId?: string;
  timeToFirstTokenMs?: number;
};

type OperationSummary = Omit<
  PreparationMetric,
  "requestId" | "conversationId" | "parentOperationId" | "promiseAllId"
> & {
  operations?: OperationSummary[];
  preparationGroups?: GroupSummary[];
};

type GroupSummary = {
  durationMs: number;
  bottleneck: string;
  promiseAllId: string;
  outcome: "fulfilled" | "rejected";
  operations: OperationSummary[];
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

const metricsByRequest = new Map<string, PreparationMetric[]>();
const firstTokens = new Map<string, FirstTokenMetric>();
for (const rawLine of logContents.split("\n")) {
  const line = stripVTControlCharacters(rawLine);
  if (line.includes("Message first token generated")) {
    const metric = JSON.parse(
      line.slice(line.indexOf("{")),
    ) as FirstTokenMetric;
    if (scenariosByConversation.has(metric.conversationId)) {
      assert(
        !firstTokens.has(metric.requestId),
        "Duplicate first-token metric",
      );
      firstTokens.set(metric.requestId, metric);
    }
  }
  if (!line.includes("Message preparation operation completed")) continue;
  const metric = JSON.parse(line.slice(line.indexOf("{"))) as PreparationMetric;
  if (!scenariosByConversation.has(metric.conversationId)) continue;
  assert(metric.operationId, "Preparation log is missing operationId");
  assert(Number.isFinite(metric.durationMs) && metric.durationMs >= 0);
  const metrics = metricsByRequest.get(metric.requestId) ?? [];
  metrics.push(metric);
  metricsByRequest.set(metric.requestId, metrics);
}
assert(metricsByRequest.size > 0, "No matching preparation logs found");

function summarizeLevel(
  metrics: PreparationMetric[],
  parentOperationId?: string,
) {
  const children = metrics.filter(
    (metric) => metric.parentOperationId === parentOperationId,
  );
  const groups = new Map<string, PreparationMetric[]>();
  const operations: OperationSummary[] = [];
  for (const child of children) {
    if (child.promiseAllId) {
      const group = groups.get(child.promiseAllId) ?? [];
      group.push(child);
      groups.set(child.promiseAllId, group);
    } else {
      operations.push(summarizeOperation(child, metrics));
    }
  }
  operations.sort((first, second) => second.durationMs - first.durationMs);
  const preparationGroups: GroupSummary[] = [...groups.entries()].map(
    ([promiseAllId, members]) => {
      members.sort((first, second) => second.durationMs - first.durationMs);
      return {
        durationMs: members[0]!.durationMs,
        bottleneck: members[0]!.operation,
        promiseAllId,
        outcome: members.some((member) => member.outcome === "rejected")
          ? "rejected"
          : "fulfilled",
        operations: members.map((member) =>
          summarizeOperation(member, metrics),
        ),
      };
    },
  );
  preparationGroups.sort(
    (first, second) => second.durationMs - first.durationMs,
  );
  return {
    ...(preparationGroups.length > 0 ? { preparationGroups } : {}),
    ...(operations.length > 0 ? { operations } : {}),
  };
}

function summarizeOperation(
  metric: PreparationMetric,
  metrics: PreparationMetric[],
): OperationSummary {
  return {
    operation: metric.operation,
    operationId: metric.operationId,
    durationMs: metric.durationMs,
    outcome: metric.outcome,
    startOffsetMs: metric.startOffsetMs,
    completedAfterMs: metric.completedAfterMs,
    ...(metric.imageCount !== undefined
      ? { imageCount: metric.imageCount }
      : {}),
    ...(metric.cachedUrlCount !== undefined
      ? { cachedUrlCount: metric.cachedUrlCount }
      : {}),
    ...(metric.urlsToSign !== undefined
      ? { urlsToSign: metric.urlsToSign }
      : {}),
    ...(metric.transcriptCount !== undefined
      ? { transcriptCount: metric.transcriptCount }
      : {}),
    ...(metric.querySkipped !== undefined
      ? { querySkipped: metric.querySkipped }
      : {}),
    ...summarizeLevel(metrics, metric.operationId),
  };
}

const requests = [...metricsByRequest.entries()].map(([requestId, metrics]) => {
  const conversationId = metrics[0]!.conversationId;
  assert(metrics.every((metric) => metric.conversationId === conversationId));
  const operationIds = new Set(metrics.map((metric) => metric.operationId));
  assert.equal(operationIds.size, metrics.length, "Duplicate operation IDs");
  for (const metric of metrics) {
    if (metric.parentOperationId) {
      const parent = metrics.find(
        (candidate) => candidate.operationId === metric.parentOperationId,
      );
      assert(
        parent &&
          parent.startOffsetMs <= metric.startOffsetMs &&
          parent.completedAfterMs >= metric.completedAfterMs,
        "Child timing must be contained in its parent operation",
      );
    }
  }
  const scenario = scenariosByConversation.get(conversationId)?.shift();
  assert(scenario, "No matching happy-path scenario for request");
  const timeToFirstTokenMs = scenario.timeToFirstTokenMs;
  assert(
    typeof timeToFirstTokenMs === "number" &&
      Number.isFinite(timeToFirstTokenMs) &&
      timeToFirstTokenMs >= 0,
    "Happy-path results must measure timeToFirstTokenMs from the live stream",
  );
  const firstToken = firstTokens.get(requestId);
  assert(firstToken, "Missing server first-token metric");
  return {
    scenario: scenario.label,
    timeToFirstTokenMs,
    requestId,
    conversationId,
    serverTimings: {
      modelStartedAfterMs: firstToken.modelStartedAfterMs,
      modelTimeToFirstTokenMs: firstToken.modelTimeToFirstTokenMs,
      firstTokenAfterMs: firstToken.firstTokenAfterMs,
    },
    ...summarizeLevel(metrics),
  };
});
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
