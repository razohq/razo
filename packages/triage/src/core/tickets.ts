import type { Cluster, IssueRef } from './model';

/** States a person set on purpose; an issue is linked but does not override them. */
const DECIDED = new Set(['ignored', 'flaky']);

export interface IssueLookup {
  /** The tracker plugin's name: only links it made are dropped when it no longer finds them. */
  name: string;
  find(signature: string): Promise<IssueRef[]>;
}

export interface LinkResult {
  clusters: Cluster[];
  /** Lookups that threw: those clusters are kept as they were. */
  failed: Array<{ clusterId: string; error: string }>;
}

/**
 * Ties the window's clusters to the issues that track them. An open issue
 * links the cluster and makes a new or acknowledged one `ticketed`; an ignore
 * or a flaky mark stands. With only a closed issue the cluster is linked but
 * not ticketed: the failure outlived its issue. A cluster this tracker had
 * linked and no longer finds is unlinked. Clusters outside `ids` are not looked up.
 */
export async function linkIssues(clusters: Cluster[], ids: string[], tracker: IssueLookup): Promise<LinkResult> {
  const wanted = new Set(ids);
  const failed: LinkResult['failed'] = [];
  const out: Cluster[] = [];
  for (const cluster of clusters) {
    if (!wanted.has(cluster.id)) { out.push(cluster); continue; }
    let refs: IssueRef[];
    try {
      refs = await tracker.find(cluster.signature);
    } catch (error) {
      failed.push({ clusterId: cluster.id, error: error instanceof Error ? error.message : String(error) });
      out.push(cluster);
      continue;
    }
    const open = refs.find((r) => r.status === 'open');
    const chosen = open ?? refs[0];
    if (!chosen) {
      const ours = cluster.linkedIssue?.tracker === tracker.name;
      if (!ours) { out.push(cluster); continue; }
      const { linkedIssue: _dropped, ...rest } = cluster;
      out.push(rest.state === 'ticketed' ? { ...rest, state: 'new' } : rest);
      continue;
    }
    let state = cluster.state;
    if (open && (state === 'new' || state === 'acknowledged')) state = 'ticketed';
    if (!open && state === 'ticketed') state = 'new';
    if (DECIDED.has(cluster.state)) state = cluster.state;
    out.push({ ...cluster, linkedIssue: chosen, state });
  }
  return { clusters: out, failed };
}
