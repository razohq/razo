import { DECISION_STATES } from '../core/decisions';
import type { TriageAction } from '../core/model';
import type { TriageStore } from '../ports/store';

export interface DecisionFeedConfig {
  url: string;
  token: string;
}

export interface FeedResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FeedFetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<FeedResponse>;

export interface PullDecisionsOptions extends DecisionFeedConfig {
  store: TriageStore;
  log?: (line: string) => void;
  /** Tests inject a fake; defaults to the global fetch. */
  fetch?: FeedFetch;
}

export interface DecisionsSummary {
  recorded: number;
  skipped: number;
}

interface FeedDecision {
  id: string;
  clusterId: string;
  action: string;
  at: string;
}

function parseFeed(body: unknown): FeedDecision[] {
  const list = (body as { decisions?: unknown } | null)?.decisions;
  if (!Array.isArray(list)) throw new Error('decision feed: expected { decisions: [...] }');
  return list.map((d, i) => {
    const item = d as Partial<Record<keyof FeedDecision, unknown>> | null;
    const ok = item !== null && typeof item === 'object'
      && (['id', 'clusterId', 'action', 'at'] as const).every((k) => typeof item[k] === 'string' && (item[k] as string).length > 0)
      && !Number.isNaN(Date.parse(item.at as string));
    if (!ok) throw new Error(`decision feed: decisions[${i}] needs string id, clusterId, action and an ISO at`);
    return item as FeedDecision;
  });
}

/**
 * Pulls decisions people took elsewhere (a dashboard's buttons) from a
 * destination implementing the decision feed contract and records each one
 * once in the store, keyed by its id. It asks from the latest decision it
 * already has; the overlap at that instant is absorbed by the id.
 */
export async function pullDecisions(options: PullDecisionsOptions): Promise<DecisionsSummary> {
  const fetchFn = options.fetch ?? (globalThis.fetch as unknown as FeedFetch);
  const recorded = (await options.store.listActions()).filter((a) => a.id !== undefined);
  const known = new Set(recorded.map((a) => a.id));
  const since = recorded.reduce((max, a) => Math.max(max, Date.parse(a.at)), 0);
  const url = new URL(options.url);
  url.searchParams.set('since', new Date(since).toISOString());
  const response = await fetchFn(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`decision feed ${url.origin}${url.pathname} answered ${response.status}`);
  const decisions = parseFeed(await response.json());
  const user = url.host;
  let added = 0;
  let skipped = 0;
  for (const d of decisions) {
    if (known.has(d.id)) continue;
    if (!(d.action in DECISION_STATES)) {
      skipped++;
      options.log?.(`warning: decision ${d.id} has an action this engine does not know (${d.action}); skipped`);
      continue;
    }
    const action: TriageAction = { id: d.id, clusterId: d.clusterId, action: d.action as TriageAction['action'], user, at: new Date(d.at).toISOString() };
    await options.store.recordAction(action);
    known.add(d.id);
    added++;
  }
  return { recorded: added, skipped };
}
