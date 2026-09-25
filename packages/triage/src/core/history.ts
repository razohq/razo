import type { Attempt, TestRun, TestStatus } from './model';

export interface TestOutcome {
  runId: string;
  sha: string;
  finishedAt: string;
  status: TestStatus;
  attempts: Attempt[];
}

export interface TestHistory {
  testId: string;
  file: string;
  /** Ascending by run start. */
  outcomes: TestOutcome[];
}

export function isFailing(status: TestStatus): boolean {
  return status === 'failed' || status === 'timedOut' || status === 'interrupted';
}

/** One history per testId, outcomes ascending by run start, whatever order the runs arrive in. */
export function testHistories(runs: TestRun[]): Map<string, TestHistory> {
  const histories = new Map<string, TestHistory>();
  for (const run of [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    for (const result of run.results) {
      const history = histories.get(result.testId) ?? { testId: result.testId, file: result.file, outcomes: [] };
      history.outcomes.push({
        runId: run.id, sha: run.sha, finishedAt: run.finishedAt, status: result.status, attempts: result.attempts,
      });
      histories.set(result.testId, history);
    }
  }
  return histories;
}

/**
 * Index of the first outcome of the failing streak that ends the history,
 * or -1 when the history does not currently end red. Skipped outcomes are
 * transparent: they neither break a streak nor count as green.
 */
function streakStart(history: TestHistory): number {
  const { outcomes } = history;
  let i = outcomes.length - 1;
  while (i >= 0 && outcomes[i].status === 'skipped') i--;
  if (i < 0 || !isFailing(outcomes[i].status)) return -1;
  let start = i;
  for (let j = i - 1; j >= 0; j--) {
    if (isFailing(outcomes[j].status)) start = j;
    else if (outcomes[j].status !== 'skipped') break;
  }
  return start;
}

/** The commit range that turned the test red: last passing sha before the current streak, first failing sha of it. */
export function shaRange(history: TestHistory): { lastGreenSha?: string; firstRedSha?: string } {
  const start = streakStart(history);
  if (start === -1) return {};
  const range: { lastGreenSha?: string; firstRedSha?: string } = { firstRedSha: history.outcomes[start].sha };
  for (let j = start - 1; j >= 0; j--) {
    const outcome = history.outcomes[j];
    if (outcome.status === 'passed') {
      range.lastGreenSha = outcome.sha;
      break;
    }
    if (outcome.status !== 'skipped') break;
  }
  return range;
}

/** True when the `n` outcomes right before the current failing streak exist and all passed. */
export function stableBefore(history: TestHistory, n: number): boolean {
  const start = streakStart(history);
  if (start === -1 || start < n) return false;
  return history.outcomes.slice(start - n, start).every((o) => o.status === 'passed');
}

/** An outcome that failed and passed within the same run (same sha): the strongest flaky signal. */
export function retryFlip(history: TestHistory): TestOutcome | undefined {
  return history.outcomes.find(
    (o) => o.attempts.some((a) => isFailing(a.status)) && o.attempts.some((a) => a.status === 'passed'),
  );
}

/** Consecutive outcomes in the last `lookbackRuns` that flipped pass/fail without the sha changing. */
export function sameShaFlips(history: TestHistory, lookbackRuns: number): number {
  const recent = history.outcomes.slice(-lookbackRuns).filter((o) => o.status !== 'skipped');
  let flips = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].sha === recent[i - 1].sha && isFailing(recent[i].status) !== isFailing(recent[i - 1].status)) flips++;
  }
  return flips;
}
