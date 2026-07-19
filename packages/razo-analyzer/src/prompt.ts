import { trimStepsTo } from './limits';
import type { AiTestReport } from './types';

export const SYSTEM_PROMPT = `You are a senior QA engineer analyzing end-to-end test failures.

The input comes from razo, a Playwright framework where every UI action and
assertion is narrated: each step carries a business-level sentence (e.g.
'Click button "Export"'), the control's human name, the action verb, and for
assertions the expected value plus the actual value read from the DOM at
failure time. You do not need to guess what the test was doing — the
narration tells you.

For each failed test, produce:
1. **What failed, in business terms** — name the business action or
   verification using the narrated sentences, not selectors or stack traces.
2. **Root-cause hypothesis** — pick the most likely one and justify it from
   the step sequence: application bug, outdated test expectation, missing
   test precondition (a step the test never performed), or environment/flake.
3. **Suggested fix** — one concrete next step.

Locator drift signals:
- A step marked "healed" means the primary selector stopped resolving and a
  deterministic fallback found the element. That is locator drift, not an
  application bug: call it out and tell the author to update the locator to
  the healed one.
- A failed step listing "DOM candidates" could not be healed. If one
  candidate clearly matches the control's name, propose the replacement
  locator as code, e.g. new Button(page, { role: 'button', name: '…' }, '…').
  If none is plausible, say the element likely no longer exists — a possible
  product regression, not a selector problem.

Be concise. Answer in Markdown. Ground every claim in specific steps from
the narration.`;

/** Renders the failed reports into the user prompt. Pure and deterministic. */
export function buildPrompt(reports: AiTestReport[]): string {
  return [
    `Analyze the following ${reports.length} failed test(s).`,
    '',
    reports.map(renderReport).join('\n\n---\n\n'),
  ].join('\n');
}

/** Renders one report exactly as it appears inside the prompt. */
export function renderReport(report: AiTestReport): string {
  const steps = report.steps
    .map((step) => {
      const parts = [`- [${step.status}] ${step.sentence}`];
      if (step.expected !== undefined) parts.push(`  expected: ${JSON.stringify(step.expected)}`);
      if (step.actual !== undefined) parts.push(`  actual:   ${JSON.stringify(step.actual)}`);
      if (step.healed) {
        parts.push(`  healed: primary ${step.healed.from} no longer resolves; found via ${step.healed.to}`);
      }
      if (step.status === 'failed' && step.error) {
        parts.push(`  error: ${step.error.split('\n')[0]}`);
      }
      if (step.status === 'failed' && step.domCandidates?.length) {
        parts.push(`  DOM candidates: ${step.domCandidates.join(' | ')}`);
      }
      return parts.join('\n');
    })
    .join('\n');

  return [
    `## Test: ${report.test}`,
    `File: ${report.file} — status: ${report.status}`,
    '',
    'Narrated steps:',
    steps || '(no narrated steps — the test failed before any control was used)',
    '',
    report.error ? `Test-level error:\n${report.error}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Character budget per prompt (~50k tokens). Keeps BYO-key analysis cost
 * predictable and far from the model's context limit even on huge suites.
 */
export const PROMPT_BUDGET_CHARS = 200_000;

export function promptBudget(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.RAZO_ANALYZE_BUDGET);
  return Number.isFinite(value) && value >= 10_000 ? value : PROMPT_BUDGET_CHARS;
}

/**
 * Shrinks one report until its rendered form fits the budget: passed steps
 * in the middle go first (failed steps and the first/last passed ones stay),
 * same marker as the uploader's truncation.
 */
export function trimReportForPrompt(report: AiTestReport, budgetChars: number): AiTestReport {
  let current = report;
  let cap = report.steps.length;
  while (renderReport(current).length > budgetChars && cap > 3) {
    cap = Math.max(Math.floor(cap / 2), 3);
    current = { ...report, steps: trimStepsTo(report.steps, cap, 'razo-analyze (prompt budget)') };
  }
  return current;
}

/**
 * Greedy packing of reports into prompt-sized batches. A report that alone
 * exceeds the budget is pre-trimmed and shipped in its own batch. Order is
 * preserved so the concatenated analyses read like one run.
 */
export function batchReports(reports: AiTestReport[], budgetChars: number): AiTestReport[][] {
  const batches: AiTestReport[][] = [];
  let batch: AiTestReport[] = [];
  let used = 0;
  for (const original of reports) {
    const size = renderReport(original).length;
    if (size > budgetChars) {
      // A report this heavy gets a trimmed batch of its own: sharing the
      // prompt would starve the neighbours of context.
      if (batch.length > 0) {
        batches.push(batch);
        batch = [];
        used = 0;
      }
      batches.push([trimReportForPrompt(original, budgetChars)]);
      continue;
    }
    if (batch.length > 0 && used + size > budgetChars) {
      batches.push(batch);
      batch = [];
      used = 0;
    }
    batch.push(original);
    used += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
