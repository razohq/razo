import type { Cluster, ClusterState, TriageAction } from './model';

/** The decisions a person can take on a cluster, and the state each one leaves it in. */
export const DECISION_STATES: Readonly<Record<string, ClusterState>> = {
  acknowledge: 'acknowledged',
  ignore: 'ignored',
  'mark-flaky': 'flaky',
  quarantine: 'flaky',
};

/** States set by people that survive a reopen: what was ignored or flaky before stays so. */
const STICKY = new Set<ClusterState>(['ignored', 'flaky']);

/**
 * Applies recorded decisions to clusters: each cluster takes the state of its
 * latest decision. Time and trackers win over people here: a resolved or
 * ticketed cluster is left alone. A reopened cluster keeps an ignore or a
 * flaky mark, but an acknowledge made before the reopen no longer holds.
 */
export function applyDecisions(clusters: Cluster[], actions: TriageAction[]): Cluster[] {
  const latest = new Map<string, TriageAction>();
  for (const action of actions) {
    if (!(action.action in DECISION_STATES)) continue;
    const before = latest.get(action.clusterId);
    if (!before || Date.parse(action.at) >= Date.parse(before.at)) latest.set(action.clusterId, action);
  }
  return clusters.map((cluster) => {
    const decision = latest.get(cluster.id);
    if (!decision || cluster.state === 'resolved' || cluster.state === 'ticketed') return cluster;
    const state = DECISION_STATES[decision.action];
    const predatesReopen = cluster.reopenedAt !== undefined && Date.parse(decision.at) < Date.parse(cluster.reopenedAt);
    if (predatesReopen && !STICKY.has(state)) return cluster;
    return state === cluster.state ? cluster : { ...cluster, state };
  });
}
