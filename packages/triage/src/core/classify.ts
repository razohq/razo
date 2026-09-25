import { failingTestIds } from './cluster';
import {
  isFailing, onBaseBranch, retryFlip, sameShaFlips, stableBefore, type TestHistory,
} from './history';
import type { Category, Cluster, Commit, Confidence, Evidence, SuspectCommit, TestRun } from './model';
import type { UnevaluableFile } from './suspects';

export interface RulesConfig {
  env: { windowMinutes: number; minFiles: number };
  flaky: { lookbackRuns: number; quarantineSuggestAfter: number };
  regression: { stableRuns: number };
  state: { resolveAfterRuns: number };
}

/** DESIGN.md §6/§10 defaults. The flaky and environment thresholds are provisional until calibrated on real nights. */
export const DEFAULT_RULES: RulesConfig = {
  env: { windowMinutes: 10, minFiles: 5 },
  flaky: { lookbackRuns: 10, quarantineSuggestAfter: 3 },
  regression: { stableRuns: 3 },
  state: { resolveAfterRuns: 3 },
};

export interface ClassifyInput {
  cluster: Cluster;
  /** Every cluster of the window, for the environment rule. */
  clusters: Cluster[];
  runs: TestRun[];
  histories: Map<string, TestHistory>;
  range: { lastGreenSha?: string; firstRedSha?: string };
  commitsInRange: Commit[];
  suspects: SuspectCommit[];
  unevaluable: UnevaluableFile[];
  /** Branch whose runs define green and red. Default: main. */
  baseBranch?: string;
}

export interface Classification {
  category: Category;
  confidence: Confidence;
  evidence: Evidence[];
}

const ENVIRONMENT = /econnrefused|econnreset|enotfound|etimedout|err_connection|err_name_not_resolved|net::err_|socket hang up|fetch failed|navigating to|page\.goto|\b5\d\d\b|service unavailable|bad gateway|gateway timeout/;
const LOCATOR = /waiting for |not found|strict mode|resolved to \d+ elements|tobevisible|tobehidden|not visible|hidden|element is not attached|detached|intercepts pointer events|locator\./;

export const isEnvironmentSignature = (signature: string): boolean => ENVIRONMENT.test(signature);
export const isLocatorSignature = (signature: string): boolean => LOCATOR.test(signature);

const short = (sha: string) => sha.slice(0, 7);
const LEVELS: Confidence[] = ['low', 'medium', 'high'];
const lower = (c: Confidence): Confidence => LEVELS[Math.max(0, LEVELS.indexOf(c) - 1)];
const lowest = (cs: Confidence[]): Confidence => cs.reduce((a, b) => (LEVELS.indexOf(a) <= LEVELS.indexOf(b) ? a : b));

/**
 * Distinct files failing with environment-like errors inside any window of
 * `windowMinutes` (by run finishedAt). Run-level timestamps are the finest
 * grain the model carries.
 */
function environmentFileBurst(runs: TestRun[], windowMinutes: number): number {
  const events: Array<{ at: number; file: string }> = [];
  for (const run of runs) {
    const at = Date.parse(run.finishedAt);
    for (const result of run.results) {
      if (result.attempts.some((a) => a.error && isEnvironmentSignature(a.error.signature))) {
        events.push({ at, file: result.file });
      }
    }
  }
  events.sort((a, b) => a.at - b.at);
  const span = windowMinutes * 60_000;
  let best = 0;
  for (let i = 0; i < events.length; i++) {
    const files = new Set<string>();
    for (let j = i; j < events.length && events[j].at - events[i].at <= span; j++) files.add(events[j].file);
    best = Math.max(best, files.size);
  }
  return best;
}

/** Every attempt of every outcome in the current base-branch streak failed: nothing passed on retry. */
function currentStreakAllFailing(history: TestHistory): boolean {
  let i = history.outcomes.length - 1;
  while (i >= 0 && history.outcomes[i].status === 'skipped') i--;
  for (; i >= 0 && isFailing(history.outcomes[i].status); i--) {
    if (!history.outcomes[i].attempts.every((a) => isFailing(a.status))) return false;
  }
  return true;
}

interface TestVerdict {
  testId: string;
  category: Category;
  confidence: Confidence;
  evidence: Evidence[];
}

/** Rules 2–5 of DESIGN.md §6 for one test of the cluster. Rule 1 (environment) is cluster-wide and runs before. */
function classifyTest(
  history: TestHistory,
  input: ClassifyInput,
  rules: RulesConfig,
  overlapping: boolean,
): TestVerdict {
  const { testId } = history;
  const evidence: Evidence[] = [];
  const options = { baseBranch: input.baseBranch };

  // 2. flaky
  const flip = retryFlip(history);
  if (flip) {
    evidence.push({ kind: 'retry', description: `${testId} failed and then passed within run ${flip.runId} at ${short(flip.sha)}` });
    return { testId, category: 'flaky', confidence: 'high', evidence };
  }
  const flips = sameShaFlips(history, rules.flaky.lookbackRuns);
  if (flips >= 2) {
    evidence.push({ kind: 'history', description: `${testId} alternated ${flips} times without a sha change in the last ${rules.flaky.lookbackRuns} runs` });
    return { testId, category: 'flaky', confidence: 'medium', evidence };
  }

  // 3. stale-test. Healed locators are evidence, never a confidence boost.
  if (isLocatorSignature(input.cluster.signature)) {
    const healed = input.runs
      .flatMap((run) => run.results)
      .find((r) => r.testId === testId && r.healedLocators?.length)?.healedLocators;
    if (overlapping || healed) {
      if (healed) {
        evidence.push({ kind: 'history', description: `${testId}: a locator already healed from ${healed[0].from} to ${healed[0].to}` });
      }
      return { testId, category: 'stale-test', confidence: 'medium', evidence };
    }
  }

  // 4. regression
  const base = onBaseBranch(history, options);
  if (stableBefore(history, rules.regression.stableRuns, options) && currentStreakAllFailing(base)) {
    evidence.push({
      kind: 'history',
      description: `${testId} passed in the ${rules.regression.stableRuns} runs before ${short(input.range.firstRedSha ?? '')} and failed every attempt since`,
    });
    return { testId, category: 'regression', confidence: overlapping ? 'high' : 'medium', evidence };
  }

  return { testId, category: 'unknown', confidence: 'low', evidence };
}

/**
 * One verdict for a cluster whose tests may have different histories
 * (DESIGN.md §6): unanimity keeps the category with the lowest confidence;
 * a majority keeps its category one confidence level lower; a tie is unknown.
 */
function resolve(verdicts: TestVerdict[]): { category: Category; confidence: Confidence; mix?: string } {
  const counts = new Map<Category, TestVerdict[]>();
  for (const v of verdicts) counts.set(v.category, [...(counts.get(v.category) ?? []), v]);
  const ranked = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
  const [topCategory, top] = ranked[0];
  const mix = ranked.map(([category, vs]) => `${vs.length} ${category}`).join(', ');
  if (ranked.length === 1) return { category: topCategory, confidence: lowest(top.map((v) => v.confidence)) };
  if (ranked[1][1].length === top.length) return { category: 'unknown', confidence: 'low', mix };
  return { category: topCategory, confidence: lower(lowest(top.map((v) => v.confidence))), mix };
}

export function classify(input: ClassifyInput, rules: RulesConfig = DEFAULT_RULES): Classification {
  const { cluster, suspects, range } = input;
  const evidence: Evidence[] = [{ kind: 'signature', description: cluster.signature }];
  if (range.lastGreenSha && range.firstRedSha) {
    evidence.push({
      kind: 'sha-range',
      description: `${short(range.lastGreenSha)}..${short(range.firstRedSha)} (${input.commitsInRange.length} commit(s))`,
    });
  }
  for (const s of suspects) {
    evidence.push({ kind: 'commit', description: `${short(s.sha)} ${s.message} — touches ${s.overlappingComponents.join(', ')}` });
  }
  for (const u of input.unevaluable) {
    evidence.push({
      kind: 'commit',
      description: `${short(u.sha)} ${u.filename} names ${u.components.join(', ')} but is unevaluable (${u.reason})`,
    });
  }
  const overlapping = suspects.some((s) => s.overlappingComponents.length > 0);

  // 1. environment: cluster-wide, by the burst of files failing together.
  if (isEnvironmentSignature(cluster.signature)) {
    const burst = environmentFileBurst(input.runs, rules.env.windowMinutes);
    if (burst >= rules.env.minFiles) {
      evidence.push({ kind: 'history', description: `${burst} files failed with network/timeout errors within ${rules.env.windowMinutes} min` });
      return { category: 'environment', confidence: input.commitsInRange.length === 0 ? 'high' : 'medium', evidence };
    }
  }

  const verdicts = failingTestIds(cluster)
    .map((id) => input.histories.get(id))
    .filter((h): h is TestHistory => !!h)
    .map((h) => classifyTest(h, input, rules, overlapping));
  if (verdicts.length === 0) return { category: 'unknown', confidence: 'low', evidence };

  for (const v of verdicts) evidence.push(...v.evidence);
  const resolved = resolve(verdicts);
  if (resolved.mix) {
    evidence.push({ kind: 'history', description: `tests in this cluster disagree: ${resolved.mix}` });
  }
  return { category: resolved.category, confidence: resolved.confidence, evidence };
}
