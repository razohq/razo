import { GitHubApi } from './adapters/github/api';
import { pullGithubArtifacts, type PullSummary } from './collectors/github-artifacts';
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
}

/** The whole morning: read the runs, analyze the window, build the report, send it everywhere. */
export async function runTriage(config: TriageConfig, options: RunOptions): Promise<RunResult> {
  const { source, code, notifiers } = instantiate(config);
  const runs = await source.fetchRuns(options.lookback);
  const items = await analyzeWindow(runs, code, config.rules, { baseBranch: config.baseBranch, since: options.since, until: options.now });
  const report = buildReport({
    items,
    runs,
    window: { from: options.since.toISOString(), to: options.now.toISOString() },
    generatedAt: options.now.toISOString(),
  });
  for (const notifier of notifiers) await notifier.send(report);
  return { report, notified: notifiers.length };
}

export interface PullCommandOptions {
  since: Date;
  dataDir: string;
  log?: (line: string) => void;
}

export async function runPull(config: TriageConfig, options: PullCommandOptions): Promise<PullSummary> {
  if (!config.pull) throw new Error('config has no "pull" section (repo, token, workflow?, branch?, artifactPrefix?)');
  const api = new GitHubApi({ token: config.pull.token });
  return pullGithubArtifacts({
    api,
    repo: config.pull.repo,
    dataDir: options.dataDir,
    since: options.since,
    workflow: config.pull.workflow,
    branch: config.pull.branch,
    artifactPrefix: config.pull.artifactPrefix,
    log: options.log,
  });
}
