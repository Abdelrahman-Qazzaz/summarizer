import assert from "node:assert/strict";
import postgres from "postgres";
import { getBaseEnv } from "../shared/env";

type BenchmarkConfiguration = {
  fetch_types: boolean;
  max: number;
  prepare: boolean;
  sslnegotiation: "direct" | undefined;
};

type QueryDispatch = {
  connectionId: number;
  dispatchedAfterMs: number;
};

const CONCURRENT_QUERY_COUNT = 5;

async function benchmark(name: string, configuration: BenchmarkConfiguration) {
  const startedAt = performance.now();
  const dispatches = new Map<number, QueryDispatch>();
  let internalQueryCount = 0;
  const client = postgres(getBaseEnv().DATABASE_URL, {
    ...configuration,
    debug(connectionId, query) {
      const match = query.match(/database_connection_benchmark_(\d+)/);
      if (!match) {
        internalQueryCount += 1;
        return;
      }
      dispatches.set(Number(match[1]), {
        connectionId,
        dispatchedAfterMs:
          Math.round((performance.now() - startedAt) * 100) / 100,
      });
    },
  } as Parameters<typeof postgres>[1]);

  async function runQuery(queryId: number) {
    const queryStartedAt = performance.now();
    const [result] = await client.unsafe<[{ value: number }]>(
      `select ${queryId}::integer as value /* database_connection_benchmark_${queryId} */`,
    );
    assert.equal(result.value, queryId);
    return Math.round((performance.now() - queryStartedAt) * 100) / 100;
  }

  try {
    const coldBatchStartedAt = performance.now();
    const coldQueryDurationsMs = await Promise.all(
      Array.from({ length: CONCURRENT_QUERY_COUNT }, (_, index) =>
        runQuery(index + 1),
      ),
    );
    const coldBatchDurationMs =
      Math.round((performance.now() - coldBatchStartedAt) * 100) / 100;

    const warmBatchStartedAt = performance.now();
    const warmQueryDurationsMs = await Promise.all(
      Array.from({ length: CONCURRENT_QUERY_COUNT }, (_, index) =>
        runQuery(index + 101),
      ),
    );
    const warmBatchDurationMs =
      Math.round((performance.now() - warmBatchStartedAt) * 100) / 100;

    const sequentialQueryDurationsMs = [];
    for (let index = 0; index < 3; index += 1) {
      sequentialQueryDurationsMs.push(await runQuery(index + 201));
    }

    return {
      name,
      configuration,
      effectiveSsl: client.options.ssl,
      coldBatchDurationMs,
      coldQueryDurationsMs,
      coldDispatches: Array.from(
        { length: CONCURRENT_QUERY_COUNT },
        (_, index) => dispatches.get(index + 1),
      ),
      coldConnectionCount: new Set(
        Array.from(
          { length: CONCURRENT_QUERY_COUNT },
          (_, index) => dispatches.get(index + 1)?.connectionId,
        ),
      ).size,
      warmBatchDurationMs,
      warmQueryDurationsMs,
      sequentialQueryDurationsMs,
      internalQueryCount,
    };
  } finally {
    await client.end({ timeout: 5 });
  }
}

const configurations: [string, BenchmarkConfiguration][] = [
  [
    "current defaults",
    { prepare: false, max: 10, fetch_types: true, sslnegotiation: undefined },
  ],
  [
    "skip custom type discovery",
    { prepare: false, max: 10, fetch_types: false, sslnegotiation: undefined },
  ],
  [
    "direct TLS and skip custom type discovery",
    { prepare: false, max: 10, fetch_types: false, sslnegotiation: "direct" },
  ],
  [
    "one connection with direct TLS",
    { prepare: false, max: 1, fetch_types: false, sslnegotiation: "direct" },
  ],
];

const results = [];
for (const [name, configuration] of configurations) {
  try {
    results.push(await benchmark(name, configuration));
  } catch (error) {
    results.push({
      name,
      configuration,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify(results, null, 2));
