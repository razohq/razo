import * as fs from 'fs';
import * as path from 'path';
import type { GitHubApi } from '../adapters/github/api';
import { writeRun, type RunManifest } from '../adapters/razo-source/layout';
import { reportsFromZip } from './unzip';

interface WorkflowRun {
  id: number;
  run_attempt: number;
  status: string;
  head_sha: string;
  head_branch: string;
  run_started_at: string;
  updated_at: string;
  html_url: string;
  pull_requests?: Array<{ number: number }>;
}

interface Artifact {
  id: number;
  name: string;
  expired: boolean;
}

export interface PullOptions {
  api: GitHubApi;
  /** owner/name */
  repo: string;
  dataDir: string;
  /** Only runs created at or after this instant are listed. */
  since: Date;
  /** Artifact name prefix, as the workflow names it. Default: razo-test-results- */
  artifactPrefix?: string;
  /** Restrict to one branch. */
  branch?: string;
  /** Workflow file name or id (e.g. e2e.yml). Default: every workflow. */
  workflow?: string;
  log?: (line: string) => void;
}

export interface PullSummary {
  pulled: string[];
  skipped: Array<{
    runId: string;
    reason: 'exists' | 'no artifact' | 'expired' | 'not completed' | 'error';
    /** For `error`: what went wrong with this run; the others still pull. */
    detail?: string;
  }>;
}

export const DEFAULT_ARTIFACT_PREFIX = 'razo-test-results-';

/**
 * Materializes GitHub Actions runs into the razo-source layout: one
 * `runs/gh-<id>-<attempt>` per run with a razo artifact. Incremental: a run
 * already on disk is never listed for artifacts nor downloaded again. Needs
 * actions:read.
 */
export async function pullGithubArtifacts(options: PullOptions): Promise<PullSummary> {
  const { api, repo, dataDir } = options;
  const prefix = options.artifactPrefix ?? DEFAULT_ARTIFACT_PREFIX;
  const log = options.log ?? (() => {});
  const params = new URLSearchParams({ created: `>=${options.since.toISOString().slice(0, 10)}` });
  if (options.branch) params.set('branch', options.branch);
  const listPath = options.workflow
    ? `/repos/${repo}/actions/workflows/${options.workflow}/runs?${params}`
    : `/repos/${repo}/actions/runs?${params}`;
  const runs = await api.getAll<WorkflowRun>(listPath, (page) => (page as { workflow_runs: WorkflowRun[] }).workflow_runs);

  const summary: PullSummary = { pulled: [], skipped: [] };
  for (const run of runs) {
    const runId = `gh-${run.id}-${run.run_attempt}`;
    try {
      await pullOne(run, runId);
    } catch (error) {
      // One broken run (expired between listing and download, a corrupt archive, a null branch) never aborts the morning.
      summary.skipped.push({ runId, reason: 'error', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;

  async function pullOne(run: WorkflowRun, runId: string): Promise<void> {
    if (fs.existsSync(path.join(dataDir, 'runs', runId))) {
      summary.skipped.push({ runId, reason: 'exists' });
      return;
    }
    if (run.status !== 'completed') {
      summary.skipped.push({ runId, reason: 'not completed' });
      return;
    }
    for (const key of ['head_sha', 'head_branch', 'run_started_at', 'updated_at', 'html_url'] as const) {
      if (typeof run[key] !== 'string' || run[key].length === 0) throw new Error(`workflow run ${run.id} has no ${key}`);
    }
    const artifacts = await api.getAll<Artifact>(
      `/repos/${repo}/actions/runs/${run.id}/artifacts`,
      (page) => (page as { artifacts: Artifact[] }).artifacts,
    );
    const candidates = artifacts.filter((a) => a.name.startsWith(prefix));
    if (candidates.length === 0) {
      summary.skipped.push({ runId, reason: 'no artifact' });
      return;
    }
    // The artifact named after this exact attempt wins; otherwise every candidate is
    // a shard of the same run and they are merged.
    const exact = candidates.filter((a) => a.name === `${prefix}${run.id}-${run.run_attempt}`);
    const chosen = (exact.length > 0 ? exact : candidates).filter((a) => !a.expired);
    if (chosen.length === 0) {
      summary.skipped.push({ runId, reason: 'expired' });
      return;
    }
    const reports: ReturnType<typeof reportsFromZip> = [];
    for (const artifact of chosen) {
      reports.push(...reportsFromZip(await api.getBinary(`/repos/${repo}/actions/artifacts/${artifact.id}/zip`)));
    }
    if (reports.length === 0) {
      // razo writes one report per test, so an archive without any is not razo's.
      summary.skipped.push({ runId, reason: 'no artifact' });
      return;
    }
    const manifest: RunManifest = {
      id: runId,
      sha: run.head_sha,
      branch: run.head_branch,
      startedAt: run.run_started_at,
      finishedAt: run.updated_at,
      ciUrl: run.html_url,
    };
    const pr = run.pull_requests?.[0]?.number;
    if (typeof pr === 'number') manifest.prNumber = pr;
    writeRun(dataDir, manifest, reports.map(({ report, retry }) => ({ report, retry })));
    summary.pulled.push(runId);
    log(`pulled ${runId} (${reports.length} report(s), ${run.head_branch} @ ${run.head_sha.slice(0, 7)})`);
  }
}
