import type { Attempt, TestRun, TestStatus } from './model';

export interface TestOutcome {
  runId: string;
  sha: string;
  branch: string;
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

export const DEFAULT_BASE_BRANCH = 'main';

export interface HistoryOptions {
  /**
   * Branch whose runs define "green" and "red". PR runs interleave with it
   * and would otherwise end or start streaks the base never saw. Default: main.
   */
  baseBranch?: string;
}

/** The history restricted to the base branch. */
export function onBaseBranch(history: TestHistory, options: HistoryOptions = {}): TestHistory {
  const baseBranch = options.baseBranch ?? DEFAULT_BASE_BRANCH;
  return { ...history, outcomes: history.outcomes.filter((o) => o.branch === baseBranch) };
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
        runId: run.id, sha: run.sha, branch: run.branch, finishedAt: run.finishedAt,
        status: result.status, attempts: result.attempts,
      });
      histories.set(result.testId, history);
    }
  }
  return histories;
}

export interface Streak {
  /** Index of the first failing outcome. */
  start: number;
  /** Index of the last failing outcome. */
  end: number;
  /** Index of the first passing outcome after it, when the streak is over. */
  greenAgain?: number;
}

/**
 * The most recent failing streak, whether it still ends the history or a
 * green run closed it: a failure fixed inside the window keeps the range
 * that explains it. Skipped outcomes are transparent: they neither break a
 * streak nor count as green.
 */
export function lastStreak(history: TestHistory): Streak | undefined {
  const { outcomes } = history;
  let end = outcomes.length - 1;
  while (end >= 0 && !isFailing(outcomes[end].status)) end--;
  if (end < 0) return undefined;
  let start = end;
  for (let j = end - 1; j >= 0; j--) {
    if (isFailing(outcomes[j].status)) start = j;
    else if (outcomes[j].status !== 'skipped') break;
  }
  // Everything after `end` passed or was skipped.
  const greenAgain = outcomes.findIndex((o, k) => k > end && o.status === 'passed');
  return greenAgain === -1 ? { start, end } : { start, end, greenAgain };
}

export interface ShaRange {
  lastGreenSha?: string;
  firstRedSha?: string;
  /** First passing sha after the streak, when it is over. */
  greenAgainSha?: string;
}

/**
 * The commit range that turned the test red on the base branch: last passing
 * sha before the latest streak, first failing sha of it, and the sha that
 * turned it green again if one did.
 */
export function shaRange(history: TestHistory, options: HistoryOptions = {}): ShaRange {
  const base = onBaseBranch(history, options);
  const streak = lastStreak(base);
  if (!streak) return {};
  const range: ShaRange = { firstRedSha: base.outcomes[streak.start].sha };
  for (let j = streak.start - 1; j >= 0; j--) {
    const outcome = base.outcomes[j];
    if (outcome.status === 'passed') {
      range.lastGreenSha = outcome.sha;
      break;
    }
    if (outcome.status !== 'skipped') break;
  }
  if (streak.greenAgain !== undefined) range.greenAgainSha = base.outcomes[streak.greenAgain].sha;
  return range;
}

/**
 * When the latest base-branch streak started (its first failing run's
 * finishedAt), or undefined when no green precedes it: then it may have
 * started before the history does, and the first sighting is the better answer.
 */
export function openSince(history: TestHistory, options: HistoryOptions = {}): string | undefined {
  const base = onBaseBranch(history, options);
  const streak = lastStreak(base);
  if (!streak || !shaRange(history, options).lastGreenSha) return undefined;
  return base.outcomes[streak.start].finishedAt;
}

/**
 * True when the `n` base-branch outcomes right before the latest failing
 * streak exist and all passed. Skipped outcomes are transparent here too.
 */
export function stableBefore(history: TestHistory, n: number, options: HistoryOptions = {}): boolean {
  const base = onBaseBranch(history, options);
  const active = { ...base, outcomes: base.outcomes.filter((o) => o.status !== 'skipped') };
  const start = lastStreak(active)?.start ?? -1;
  if (start === -1 || start < n) return false;
  return active.outcomes.slice(start - n, start).every((o) => o.status === 'passed');
}

/** An outcome that failed and passed within the same run (same sha): the strongest flaky signal. */
export function retryFlip(history: TestHistory): TestOutcome | undefined {
  return history.outcomes.find(
    (o) => o.attempts.some((a) => isFailing(a.status)) && o.attempts.some((a) => a.status === 'passed'),
  );
}

/** Consecutive outcomes in the last `lookbackRuns`, on any branch, that flipped pass/fail without the sha changing. */
export function sameShaFlips(history: TestHistory, lookbackRuns: number): number {
  const recent = history.outcomes.slice(-lookbackRuns).filter((o) => o.status !== 'skipped');
  let flips = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].sha === recent[i - 1].sha && isFailing(recent[i].status) !== isFailing(recent[i - 1].status)) flips++;
  }
  return flips;
}
