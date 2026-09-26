import type { Cluster, TestRun } from './model';

/**
 * Combines the clusters the store remembers with the ones this run produced.
 * A known cluster keeps what people and time decided about it (state,
 * firstSeenAt, linkedIssue) and takes everything the rules recomputed
 * (failures, category, confidence, range, suspects, lastSeenAt). A cluster
 * absent from this run is kept as it was: an ignored cluster stays ignored
 * across quiet mornings. An unknown cluster enters as produced.
 */
export function mergeClusters(previous: Cluster[], current: Cluster[]): Cluster[] {
  const known = new Map(previous.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const merged: Cluster[] = current.map((cluster) => {
    seen.add(cluster.id);
    const before = known.get(cluster.id);
    if (!before) return cluster;
    return {
      ...cluster,
      state: before.state,
      firstSeenAt: before.firstSeenAt,
      ...(before.linkedIssue ? { linkedIssue: before.linkedIssue } : {}),
    };
  });
  for (const cluster of previous) {
    if (!seen.has(cluster.id)) merged.push(cluster);
  }
  return merged;
}

export interface StateContext {
  /** Every run the pipeline saw (the lookback), to count runs after a cluster's last failure. */
  runs: TestRun[];
  /** Branch whose runs count toward resolution. Default: main. */
  baseBranch?: string;
  /** Base-branch runs without the cluster's failure before it becomes resolved. */
  resolveAfterRuns: number;
}

/**
 * mergeClusters plus what time decides: novelty (new or recurring), a cluster
 * absent for `resolveAfterRuns` base-branch runs after its last failure
 * becomes resolved, and a resolved cluster that fails again is reopened: state
 * new, novelty reopened, history kept.
 */
export function reconcileClusters(previous: Cluster[], current: Cluster[], context: StateContext): Cluster[] {
  const known = new Set(previous.map((c) => c.id));
  const present = new Set(current.map((c) => c.id));
  const baseBranch = context.baseBranch ?? 'main';
  const baseRuns = context.runs.filter((r) => r.branch === baseBranch);
  return mergeClusters(previous, current).map((cluster) => {
    if (present.has(cluster.id)) {
      if (cluster.state === 'resolved') return { ...cluster, novelty: 'reopened', state: 'new' };
      return { ...cluster, novelty: known.has(cluster.id) ? 'recurring' : 'new' };
    }
    if (cluster.state === 'resolved') return cluster;
    const since = Date.parse(cluster.lastSeenAt);
    const quiet = baseRuns.filter((r) => Date.parse(r.finishedAt) > since).length;
    return quiet >= context.resolveAfterRuns ? { ...cluster, state: 'resolved' } : cluster;
  });
}
