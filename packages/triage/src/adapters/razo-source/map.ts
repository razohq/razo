import type { Attempt, TestError, TestResult, TestRun, TestStatus, TouchedControl } from '../../core/model';
import { errorSignature } from '../../core/signature';
import type { RazoReport, RunManifest, StoredReport } from './layout';

export const SOURCE_NAME = 'razo-source';

const STATUSES: ReadonlySet<string> = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const FAILING: ReadonlySet<string> = new Set(['failed', 'timedOut', 'interrupted']);

function toStatus(raw: string): TestStatus {
  return (STATUSES.has(raw) ? raw : 'failed') as TestStatus;
}

function errorOf(report: RazoReport, status: TestStatus): TestError | undefined {
  if (!FAILING.has(status)) return undefined;
  const lastFailedStep = [...report.steps].reverse().find((s) => s.status === 'failed' && s.error);
  const message = report.error ?? lastFailedStep?.error ?? `${status} without error message`;
  return { message, signature: errorSignature(message) };
}

function toAttempt(report: RazoReport): Attempt {
  const status = toStatus(report.status);
  const attempt: Attempt = { status, durationMs: report.durationMs };
  const error = errorOf(report, status);
  if (error) attempt.error = error;
  return attempt;
}

const testKey = (r: RazoReport) => `${r.file}::${r.test}${r.project ? `::${r.project}` : ''}`;

/** Every retry of one test, in retry order. */
function groupByTest(reports: StoredReport[]): Map<string, StoredReport[]> {
  const groups = new Map<string, StoredReport[]>();
  for (const stored of reports) {
    const key = testKey(stored.report);
    const group = groups.get(key) ?? [];
    group.push(stored);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort((a, b) => a.retry - b.retry);
  return groups;
}

function controlsOf(reports: RazoReport[]): TouchedControl[] {
  const seen = new Map<string, TouchedControl>();
  const add = (controlType: string, name: string, selector: string) => {
    const key = `${controlType}\u0000${name}\u0000${selector}`;
    if (!seen.has(key)) seen.set(key, { controlType, name, selector });
  };
  for (const report of reports) {
    for (const step of report.steps) {
      // The pre-heal selector is what the test source names; keep it for suspects.
      if (step.healed) add(step.controlType, step.name, step.healed.from);
      add(step.controlType, step.name, step.selector);
    }
  }
  return [...seen.values()];
}

function healedOf(reports: RazoReport[]): Array<{ from: string; to: string }> | undefined {
  const seen = new Map<string, { from: string; to: string }>();
  for (const report of reports) {
    for (const step of report.steps) {
      if (step.healed) seen.set(`${step.healed.from}\u0000${step.healed.to}`, { from: step.healed.from, to: step.healed.to });
    }
  }
  return seen.size > 0 ? [...seen.values()] : undefined;
}

export function toTestRun(manifest: RunManifest, reports: StoredReport[]): TestRun {
  const results: TestResult[] = [];
  for (const [testId, group] of groupByTest(reports)) {
    const attempts = group.map((s) => toAttempt(s.report));
    const final = attempts[attempts.length - 1];
    const first = group[0].report;
    const plain = group.map((s) => s.report);
    const result: TestResult = {
      testId,
      title: first.test,
      file: first.file,
      status: final.status,
      attempts,
      durationMs: final.durationMs,
    };
    if (first.project) result.project = first.project;
    if (final.error) result.error = final.error;
    const controls = controlsOf(plain);
    if (controls.length > 0) {
      result.controls = controls;
      result.touchedComponents = [...new Set(controls.map((c) => `${c.controlType} "${c.name}"`))];
    }
    const healed = healedOf(plain);
    if (healed) result.healedLocators = healed;
    if (manifest.ciUrl) result.traceUrl = manifest.ciUrl;
    results.push(result);
  }
  return {
    id: manifest.id,
    sha: manifest.sha,
    branch: manifest.branch,
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    source: SOURCE_NAME,
    results,
  };
}
