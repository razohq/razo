import { GitHubApi } from './adapters/github/api';
import { pullGithubArtifacts, type PullSummary } from './collectors/github-artifacts';
import { restoreState, type RestoreResult } from './collectors/state-artifact';
import { instantiate } from './config/registry';
import type { TriageConfig } from './config/schema';
import type { TriageReport } from './core/model';
import { analyzeWindow } from './core/pipeline';
import { buildReport } from './core/report';

/** `24h`, `7d`, `30m` relative to `now`, or an ISO date. */
export function parseDuration(text: string, now: Date): Date {
  const m = text.match(/^(\d+)([mhd])$/);
  if (m) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'];
    return new Date(now.getTime() - Number(m[1]) * unit);
  }
  const at = Date.parse(text);
  if (Number.isNaN(at)) throw new Error(`not a duration or date: ${text}`);
  return new Date(at);
}

export interface RunOptions {
  now: Date;
  /** Window start: failures at or after it are triaged. */
  since: Date;
  /** History start: runs at or after it feed ranges and flakiness. */
  lookback: Date;
}

export interface RunResult {
  report: TriageReport;
  notified: number;
  /** True when a store is configured and the run and its clusters were recorded in it. */
  stored: boolean;
}

/** The whole morning: read the runs, analyze the window, build the report, send it everywhere. */
export async function runTriage(config: TriageConfig, options: RunOptions): Promise<RunResult> {
  const { source, code, notifiers, store } = instantiate(config);
  const startedAt = Date.now();
  const runs = await source.fetchRuns(options.lookback);
  const items = await analyzeWindow(runs, code, config.rules, { baseBranch: config.baseBranch, since: options.since, until: options.now });
  // Totals describe the window; the lookback only feeds history.
  const windowRuns = runs.filter((run) => {
    const at = Date.parse(run.finishedAt);
    return at >= options.since.getTime() && at <= options.now.getTime();
  });
  const report = buildReport({
    items,
    runs: windowRuns,
    window: { from: options.since.toISOString(), to: options.now.toISOString() },
    generatedAt: options.now.toISOString(),
  });
  for (const notifier of notifiers) await notifier.send(report);
  if (store) {
    // Cluster states, novelty and days open come with the next step of Phase 3; for now the
    // store remembers the run and the clusters as the rules left them.
    await store.saveClusters(items.map((i) => i.cluster));
    await store.recordRun({
      id: `triage-${report.generatedAt}`,
      generatedAt: report.generatedAt,
      window: report.window,
      totals: report.totals,
      durationMs: Date.now() - startedAt,
    });
  }
  return { report, notified: notifiers.length, stored: Boolean(store) };
}

export interface PullCommandOptions {
  since: Date;
  dataDir: string;
  log?: (line: string) => void;
}

export interface PullResult extends PullSummary {
  /** Present when the config has a json-file store: whether the state artifact was restored into it. */
  state?: RestoreResult;
}

export async function runPull(config: TriageConfig, options: PullCommandOptions): Promise<PullResult> {
  if (!config.pull) throw new Error('config has no "pull" section (repo, token, workflow?, branch?, artifactPrefix?)');
  const api = new GitHubApi({ token: config.pull.token });
  let state: RestoreResult | undefined;
  const storeFile = config.store?.plugin === 'json-file' ? (config.store.config as { path?: string } | undefined)?.path : undefined;
  if (storeFile) {
    state = await restoreState({ api, repo: config.pull.repo, file: storeFile });
    options.log?.(state.restored
      ? `restored triage state from artifact #${state.artifactId} (${state.createdAt})`
      : 'no triage state artifact found: starting from an empty state');
  }
  const summary = await pullGithubArtifacts({
    api,
    repo: config.pull.repo,
    dataDir: options.dataDir,
    since: options.since,
    workflow: config.pull.workflow,
    branch: config.pull.branch,
    artifactPrefix: config.pull.artifactPrefix,
    log: options.log,
  });
  return state ? { ...summary, state } : summary;
}
