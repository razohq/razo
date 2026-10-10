import { DECISION_STATES } from './decisions';
import type { Cluster, TestRun, TriageAction } from './model';

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
    // Failures accumulate across mornings, deduplicated by run and test; the first sighting never moves forward.
    const seenFailures = new Set(before.failures.map((f) => `${f.runId}\u0000${f.testId}`));
    const failures = [...before.failures, ...cluster.failures.filter((f) => !seenFailures.has(`${f.runId}\u0000${f.testId}`))];
    return {
      ...cluster,
      failures,
      state: before.state,
      firstSeenAt: before.firstSeenAt < cluster.firstSeenAt ? before.firstSeenAt : cluster.firstSeenAt,
      ...(before.linkedIssue ? { linkedIssue: before.linkedIssue } : {}),
      ...(before.reopenedAt ? { reopenedAt: before.reopenedAt } : {}),
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
      if (cluster.state === 'resolved') return { ...cluster, novelty: 'reopened', state: 'new', reopenedAt: cluster.lastSeenAt };
      return { ...cluster, novelty: known.has(cluster.id) ? 'recurring' : 'new' };
    }
    if (cluster.state === 'resolved') return cluster;
    const since = Date.parse(cluster.lastSeenAt);
    const quiet = baseRuns.filter((r) => Date.parse(r.finishedAt) > since).length;
    return quiet >= context.resolveAfterRuns ? { ...cluster, state: 'resolved' } : cluster;
  });
}

/** Decisions that survive a reopen (core/decisions.ts): pruning such a cluster would forget them. */
const KEEPS_ACROSS_REOPEN = new Set(['ignored', 'flaky']);

/**
 * Drops clusters that are resolved and have not failed for `afterDays`, so
 * the state does not grow with every failure ever seen. A cluster stays when
 * it links an issue or when its latest decision is one a reopen keeps
 * (ignore, flaky): pruned, it would come back as new and lose it. Recorded
 * actions are left alone. `afterDays` 0 keeps everything.
 */
export function pruneResolved(
  clusters: Cluster[],
  actions: TriageAction[],
  options: { now: Date; afterDays: number },
): { kept: Cluster[]; pruned: string[] } {
  if (options.afterDays <= 0) return { kept: clusters, pruned: [] };
  const latest = new Map<string, TriageAction>();
  for (const action of actions) {
    if (!(action.action in DECISION_STATES)) continue;
    const before = latest.get(action.clusterId);
    if (!before || Date.parse(action.at) >= Date.parse(before.at)) latest.set(action.clusterId, action);
  }
  const cutoff = options.now.getTime() - options.afterDays * 86_400_000;
  const kept: Cluster[] = [];
  const pruned: string[] = [];
  for (const cluster of clusters) {
    const decision = latest.get(cluster.id);
    const sticky = decision !== undefined && KEEPS_ACROSS_REOPEN.has(DECISION_STATES[decision.action]);
    const prunable = cluster.state === 'resolved' && Date.parse(cluster.lastSeenAt) < cutoff && !cluster.linkedIssue && !sticky;
    if (prunable) pruned.push(cluster.id);
    else kept.push(cluster);
  }
  return { kept, pruned };
}
