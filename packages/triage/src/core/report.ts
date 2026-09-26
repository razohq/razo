import { failingTestIds } from './cluster';
import type { IssueDraft, ProposedAction, TestRun, TriageReport } from './model';
import type { TriageItem } from './pipeline';

export interface ReportInput {
  items: TriageItem[];
  /** Every run the pipeline saw; totals count the distinct tests among them. */
  runs: TestRun[];
  window: { from: string; to: string };
  generatedAt?: string;
}

const short = (sha: string) => sha.slice(0, 7);

function titleOf(item: TriageItem, runs: TestRun[]): string {
  const [testId] = failingTestIds(item.cluster);
  for (const run of runs) {
    const result = run.results.find((r) => r.testId === testId);
    if (result) return result.title;
  }
  return testId;
}

function draftFor(item: TriageItem, runs: TestRun[]): IssueDraft {
  const { cluster, classification } = item;
  const lines = [
    `Category: ${classification.category} (${classification.confidence})`,
    '',
    'Tests:',
    ...failingTestIds(cluster).map((id) => `- ${id}`),
    '',
    `Signature: ${cluster.signature}`,
  ];
  if (cluster.lastGreenSha && cluster.firstRedSha) {
    lines.push('', `Range: ${short(cluster.lastGreenSha)}..${short(cluster.firstRedSha)}`);
  }
  if (cluster.suspectCommits.length > 0) {
    lines.push('', 'Suspects:', ...cluster.suspectCommits.map((s) => `- ${short(s.sha)} ${s.message} (${s.overlappingComponents.join(', ')})`));
  }
  lines.push('', 'Evidence:', ...classification.evidence.map((e) => `- [${e.kind}] ${e.description}`));
  return {
    title: `[triage] ${classification.category}: ${titleOf(item, runs)}`,
    body: lines.join('\n'),
    signature: cluster.signature,
    labels: ['triage', classification.category],
  };
}

function actionsFor(item: TriageItem, runs: TestRun[]): ProposedAction[] {
  switch (item.classification.category) {
    case 'flaky': return [{ type: 'mark-flaky' }];
    case 'environment': return [{ type: 'ignore' }];
    case 'regression':
    case 'stale-test': return [{ type: 'create-issue', draft: draftFor(item, runs) }];
    default: return [];
  }
}

function nextStepFor(item: TriageItem): string {
  const suspect = item.cluster.suspectCommits[0];
  switch (item.classification.category) {
    case 'flaky': return 'Mark the test flaky; quarantine it if it keeps flipping.';
    case 'environment': return 'Check the environment for that window; no code change is implied.';
    case 'stale-test': return suspect
      ? `Update the test for ${short(suspect.sha)} (${suspect.message}) or revert the change if it was not intended.`
      : 'Update the test to the current UI, or confirm the element really disappeared.';
    case 'regression': return suspect
      ? `Review ${short(suspect.sha)} (${suspect.message}); it touches ${suspect.overlappingComponents.join(', ')}.`
      : 'Bisect the range; no commit names the controls the test used.';
    default: return 'Not enough history to decide; watch the next runs.';
  }
}

/** The report stage: verdicts and proposed actions per cluster, plus totals for the window. */
export function buildReport(input: ReportInput): TriageReport {
  const tests = new Set<string>();
  for (const run of input.runs) for (const r of run.results) tests.add(r.testId);
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    window: input.window,
    totals: {
      tests: tests.size,
      failures: input.items.reduce((n, i) => n + i.cluster.failures.length, 0),
      clusters: input.items.length,
    },
    items: input.items.map((item) => ({
      cluster: item.cluster,
      verdict: {
        clusterId: item.cluster.id,
        category: item.classification.category,
        confidence: item.classification.confidence,
        summary: item.classification.evidence.find((e) => e.kind === 'history' || e.kind === 'retry')?.description ?? item.cluster.signature,
        nextStep: nextStepFor(item),
        evidence: item.classification.evidence,
        origin: 'rules',
      },
      proposedActions: actionsFor(item, input.runs),
    })),
  };
}
