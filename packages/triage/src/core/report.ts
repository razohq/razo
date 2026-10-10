import { failingTestIds } from './cluster';
import type { IssueDraft, ProposedAction, TestRun, TriageAction, TriageReport } from './model';
import type { TriageItem } from './pipeline';

export interface ReportInput {
  items: TriageItem[];
  /** Every run the pipeline saw; totals count the distinct tests among them. */
  runs: TestRun[];
  window: { from: string; to: string };
  generatedAt?: string;
  /** Recorded actions per cluster id, from the store. */
  actions?: Map<string, TriageAction[]>;
  /** A cluster marked flaky this many times gets quarantine proposed instead. Default: 3. */
  quarantineSuggestAfter?: number;
  /** From the tracker: where a person creates a proposed issue themselves. */
  issueUrl?: (draft: IssueDraft) => string;
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

function draftFor(item: TriageItem, runs: TestRun[], issueUrl?: (draft: IssueDraft) => string): IssueDraft {
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
  const draft: IssueDraft = {
    title: `[triage] ${classification.category}: ${titleOf(item, runs)}`,
    body: lines.join('\n'),
    signature: cluster.signature,
    labels: ['triage', classification.category],
  };
  return issueUrl ? { ...draft, url: issueUrl(draft) } : draft;
}

const tracked = (item: TriageItem) => item.cluster.linkedIssue?.status === 'open';

/** A regression or stale test that green runs already closed: nothing left to fix unless the fix was temporary. */
const fixedAlready = (item: TriageItem): boolean =>
  !!item.range.greenAgainSha && (item.classification.category === 'regression' || item.classification.category === 'stale-test');

function actionsFor(item: TriageItem, runs: TestRun[], input: ReportInput): ProposedAction[] {
  if (fixedAlready(item) || tracked(item)) return [];
  switch (item.classification.category) {
    case 'flaky': {
      const marks = (input.actions?.get(item.cluster.id) ?? []).filter((a) => a.action === 'mark-flaky').length;
      return marks >= (input.quarantineSuggestAfter ?? 3) ? [{ type: 'quarantine' }] : [{ type: 'mark-flaky' }];
    }
    case 'environment': return [{ type: 'ignore' }];
    case 'regression':
    case 'stale-test': return [{ type: 'create-issue', draft: draftFor(item, runs, input.issueUrl) }];
    default: return [];
  }
}

function nextStepFor(item: TriageItem): string {
  const suspect = item.cluster.suspectCommits[0];
  const issue = item.cluster.linkedIssue;
  if (issue && tracked(item)) return `Tracked in ${issue.key} (${issue.url}); follow it there.`;
  if (fixedAlready(item)) {
    const broke = item.range.firstRedSha ? `It broke at ${short(item.range.firstRedSha)}` : 'It broke earlier';
    const who = suspect ? `, suspect ${short(suspect.sha)} (${suspect.message})` : '';
    return `Green again since ${short(item.range.greenAgainSha!)}. ${broke}${who}; open an issue only if the fix was a temporary revert.`;
  }
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
  const windowRuns = new Set<string>();
  for (const run of input.runs) {
    windowRuns.add(run.id);
    for (const r of run.results) tests.add(r.testId);
  }
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    window: input.window,
    totals: {
      tests: tests.size,
      // Clusters carry their whole history; the header describes the window only.
      failures: input.items.reduce((n, i) => n + i.cluster.failures.filter((f) => windowRuns.has(f.runId)).length, 0),
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
      proposedActions: actionsFor(item, input.runs, input),
    })),
  };
}
