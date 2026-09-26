import type { Cluster } from './model';

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
