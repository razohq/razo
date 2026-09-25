import * as fs from 'fs';
import * as path from 'path';

/** Written by a collector (or a fixture script) next to the reports of one run. */
export interface RunManifest {
  id: string;
  sha: string;
  branch: string;
  startedAt: string;
  finishedAt: string;
  ciUrl?: string;
  prNumber?: number;
  /** True for generated fixtures: real reporter, scripted behaviour. */
  synthetic?: boolean;
}

/** One StepEvent as razo writes it. Extra keys (detail, expected, actual, domCandidates…) pass through. */
export interface RazoStep {
  action: string;
  controlType: string;
  name: string;
  sentence: string;
  selector: string;
  status: 'passed' | 'failed';
  error?: string;
  healed?: { from: string; to: string };
  timestamp: string;
  [key: string]: unknown;
}

/**
 * One razo-steps.json. `retry` and `project` are absent until razo's reporter
 * writes them; when present they win over anything inferred from the path.
 */
export interface RazoReport {
  test: string;
  file: string;
  project?: string;
  retry?: number;
  status: string;
  durationMs: number;
  error?: string;
  steps: RazoStep[];
}

export interface StoredReport {
  report: RazoReport;
  /** Playwright retry index: the report's own field, else the `-retryN` directory suffix, else 0. */
  retry: number;
  /** Path relative to the run directory, for error messages. */
  relPath: string;
}

export interface StoredRun {
  manifest: RunManifest;
  reports: StoredReport[];
}

const REQUIRED: Array<keyof RunManifest> = ['id', 'sha', 'branch', 'startedAt', 'finishedAt'];
const RETRY_SUFFIX = /-retry(\d+)$/;

function readManifest(runDir: string): RunManifest {
  const file = path.join(runDir, 'run.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${runDir}: cannot read run.json (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${runDir}: run.json must be an object`);
  }
  const manifest = parsed as Record<string, unknown>;
  for (const key of REQUIRED) {
    if (typeof manifest[key] !== 'string' || (manifest[key] as string).length === 0) {
      throw new Error(`${runDir}: run.json is missing "${key}"`);
    }
  }
  for (const key of ['startedAt', 'finishedAt'] as const) {
    if (Number.isNaN(Date.parse(manifest[key] as string))) {
      throw new Error(`${runDir}: run.json has an unparseable "${key}": ${JSON.stringify(manifest[key])}`);
    }
  }
  return manifest as unknown as RunManifest;
}

function walkReports(dir: string, rel = ''): Array<{ file: string; relPath: string }> {
  if (!fs.existsSync(dir)) return [];
  const found: Array<{ file: string; relPath: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...walkReports(path.join(dir, entry.name), relPath));
    else if (entry.name === 'razo-steps.json' || entry.name === 'ai-steps.json') {
      found.push({ file: path.join(dir, entry.name), relPath });
    }
  }
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Reads every run under `<dataDir>/runs`. Throws on a run whose run.json is missing or incomplete. */
export function readRuns(dataDir: string): StoredRun[] {
  const runsDir = path.join(dataDir, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  const runs: StoredRun[] = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDir = path.join(runsDir, entry.name);
    const manifest = readManifest(runDir);
    const reports = walkReports(path.join(runDir, 'reports')).map(({ file, relPath }) => {
      let report: RazoReport;
      try {
        report = JSON.parse(fs.readFileSync(file, 'utf8')) as RazoReport;
      } catch (error) {
        throw new Error(`${runDir}/reports/${relPath}: cannot read report (${error instanceof Error ? error.message : String(error)})`);
      }
      if (typeof report !== 'object' || report === null) throw new Error(`${runDir}/reports/${relPath}: report must be an object`);
      report.steps = Array.isArray(report.steps) ? report.steps : [];
      const fromDir = Number(path.basename(path.dirname(file)).match(RETRY_SUFFIX)?.[1] ?? 0);
      const retry = typeof report.retry === 'number' && report.retry >= 0 ? report.retry : fromDir;
      return { report, retry, relPath: `reports/${relPath}` };
    });
    runs.push({ manifest, reports });
  }
  return runs;
}

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** Writes one run in the layout. Used by fixture scripts and by collectors. Returns the run directory. */
export function writeRun(
  dataDir: string,
  manifest: RunManifest,
  reports: Array<{ report: RazoReport; retry: number }>,
): string {
  const runDir = path.join(dataDir, 'runs', manifest.id);
  fs.mkdirSync(path.join(runDir, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const { report, retry } of reports) {
    const base = `${slug(path.basename(report.file).replace(/\.(spec|test)\.[cm]?[jt]s$/, ''))}-${slug(report.test)}`;
    const dir = path.join(runDir, 'reports', retry > 0 ? `${base}-retry${retry}` : base);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'razo-steps.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return runDir;
}
