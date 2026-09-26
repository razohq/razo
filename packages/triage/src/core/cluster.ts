import type { Cluster, FailureRef, TestRun } from './model';
import { clusterIdOf } from './signature';

/**
 * Groups every failed attempt in the runs by error signature. Attempts, not
 * final statuses: a test that failed once and passed on retry is exactly the
 * evidence the flaky rule needs, and it must not vanish here.
 */
export function clusterFailures(runs: TestRun[]): Cluster[] {
  const bySignature = new Map<string, Cluster>();
  const ordered = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const run of ordered) {
    for (const result of run.results) {
      for (const attempt of result.attempts) {
        if (!attempt.error) continue;
        const { signature } = attempt.error;
        const ref: FailureRef = { runId: run.id, testId: result.testId, sha: run.sha };
        const cluster = bySignature.get(signature);
        if (cluster) {
          cluster.failures.push(ref);
          if (run.finishedAt < cluster.firstSeenAt) cluster.firstSeenAt = run.finishedAt;
          if (run.finishedAt > cluster.lastSeenAt) cluster.lastSeenAt = run.finishedAt;
        } else {
          bySignature.set(signature, {
            id: clusterIdOf(signature),
            signature,
            failures: [ref],
            category: 'unknown',
            confidence: 'low',
            novelty: 'new',
            firstSeenAt: run.finishedAt,
            lastSeenAt: run.finishedAt,
            suspectCommits: [],
            state: 'new',
          });
        }
      }
    }
  }
  return [...bySignature.values()].sort(
    (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || b.failures.length - a.failures.length,
  );
}

/** Distinct tests in the cluster, in first-seen order. */
export function failingTestIds(cluster: Cluster): string[] {
  return [...new Set(cluster.failures.map((f) => f.testId))];
}
