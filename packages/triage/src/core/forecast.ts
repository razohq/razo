// Adapted from playwright-smart-reporter (src/analyzers/flake-forecast.ts),
// MIT License, Copyright (c) 2024 Gary Parker (full text in THIRD-PARTY-NOTICES.md).
// Differences: it reads the base branch's runs, a flip across a commit weighs
// `crossShaFlipWeight` of one on the same commit, durations come from passed
// runs only, and a duration change under `minDurationChangeMs` is jitter
// (smart-reporter: 50ms spread, 100ms rise).
import type { RulesConfig } from './classify';
import { DEFAULT_BASE_BRANCH, isFailing, onBaseBranch, testHistories, type TestOutcome } from './history';
import type { AtRiskTest, ForecastSignal, TestRun } from './model';

export type ForecastConfig = RulesConfig['forecast'];

export interface ForecastOptions {
  /** Branch whose runs are forecast. Default: main. */
  baseBranch?: string;
  /** Tests left out, typically those already in one of the window's clusters. */
  exclude?: Iterable<string>;
}

/**
 * How much each signal can add at full strength. The signals combine as a
 * noisy-OR, risk = 1 - prod(1 - cap * strength): one strong signal can flag a
 * test, weak ones only together. The constants below shape the signals and
 * are documented in DESIGN.md §6; the thresholds people tune are in the config.
 */
const CAP: Record<ForecastSignal, number> = {
  'outcome-instability': 0.9,
  'retry-trend': 0.8,
  'duration-variance': 0.7,
  'duration-drift': 0.5,
};
const SIGNAL_ORDER = Object.keys(CAP) as ForecastSignal[];
/** Weighted flip rate (and retry rate) at which the signal reaches full strength. */
const FLIP_RATE_FULL = 0.35;
const RETRY_RATE_FULL = 0.25;
/** Scales a median absolute deviation to estimate a standard deviation. */
const MAD_TO_SD = 1.4826;
const SPREAD_WIDENING_FLOOR = 0.05;
const SPREAD_WIDENING_RANGE = 0.25;
/** A median over fewer samples moves with a single spike. */
const MIN_DURATION_HALF = 4;
const DRIFT_FLOOR = 0.2;
const DRIFT_RANGE = 1;
/** Reasons that add less than this are left out of the report. */
const MIN_REASON_WEIGHT = 0.05;

interface Strength {
  signal: ForecastSignal;
  strength: number;
  detail: string;
}

const retried = (o: TestOutcome) => o.attempts.length > 1;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round2 = (x: number) => Math.round(x * 100) / 100;
const ago = (age: number) => (age === 0 ? 'this run' : age === 1 ? '1 run ago' : `${age} runs ago`);
const times = (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

function outcomeInstability(runs: TestOutcome[], recency: (age: number) => number, config: ForecastConfig): Strength | undefined {
  const n = runs.length;
  let flips = 0;
  let flipWeight = 0;
  let totalWeight = 0;
  let lastFlipAge = -1;
  for (let k = 1; k < n; k++) {
    const w = recency(n - 1 - k);
    totalWeight += w;
    if (isFailing(runs[k].status) !== isFailing(runs[k - 1].status)) {
      flips++;
      // A flip across a commit is most likely that commit; one on the same commit is the test.
      flipWeight += w * (runs[k].sha === runs[k - 1].sha ? 1 : config.crossShaFlipWeight);
      lastFlipAge = n - 1 - k;
    }
  }
  if (flips === 0) return undefined;
  return {
    signal: 'outcome-instability',
    strength: clamp01(flipWeight / totalWeight / FLIP_RATE_FULL),
    detail: `Pass/fail flipped ${times(flips)} in the last ${n} runs, most recently ${ago(lastFlipAge)}`,
  };
}

function retryTrend(runs: TestOutcome[], recency: (age: number) => number): Strength | undefined {
  const n = runs.length;
  let count = 0;
  let retryWeight = 0;
  let totalWeight = 0;
  let lastAge = -1;
  runs.forEach((o, i) => {
    const w = recency(n - 1 - i);
    totalWeight += w;
    if (retried(o)) {
      count++;
      retryWeight += w;
      lastAge = n - 1 - i;
    }
  });
  if (count === 0) return undefined;
  return {
    signal: 'retry-trend',
    strength: clamp01(retryWeight / totalWeight / RETRY_RATE_FULL),
    detail: `Retried in ${count} of the last ${n} runs, most recently ${ago(lastAge)}`,
  };
}

/** Older and recent halves of the passed runs' durations: a failure's duration is a timeout, not the test getting slower. */
function halves(runs: TestOutcome[]): [number[], number[]] | undefined {
  const durations = runs
    .filter((o) => o.status === 'passed')
    .map((o) => o.attempts[o.attempts.length - 1]?.durationMs ?? 0);
  const split = Math.floor(durations.length / 2);
  if (split < MIN_DURATION_HALF) return undefined;
  return [durations.slice(0, durations.length - split), durations.slice(durations.length - split)];
}

function durationVariance(runs: TestOutcome[], config: ForecastConfig): Strength | undefined {
  const split = halves(runs);
  if (!split) return undefined;
  const [older, recent] = split;
  const recentMedian = median(recent);
  const recentSpread = MAD_TO_SD * mad(recent);
  if (recentMedian <= 0 || recentSpread < config.minDurationChangeMs) return undefined;
  const olderMedian = median(older);
  const olderCv = olderMedian > 0 ? (MAD_TO_SD * mad(older)) / olderMedian : 0;
  const recentCv = recentSpread / recentMedian;
  const strength = clamp01((recentCv - olderCv - SPREAD_WIDENING_FLOOR) / SPREAD_WIDENING_RANGE);
  if (strength === 0) return undefined;
  return {
    signal: 'duration-variance',
    strength,
    detail: `Duration spread widened from ±${Math.round(olderCv * 100)}% to ±${Math.round(recentCv * 100)}% of the median`,
  };
}

function durationDrift(runs: TestOutcome[], config: ForecastConfig): Strength | undefined {
  const split = halves(runs);
  if (!split) return undefined;
  const [older, recent] = split;
  const before = median(older);
  const after = median(recent);
  if (before <= 0 || after - before < config.minDurationChangeMs) return undefined;
  const drift = (after - before) / before;
  const strength = clamp01((drift - DRIFT_FLOOR) / DRIFT_RANGE);
  if (strength === 0) return undefined;
  return {
    signal: 'duration-drift',
    strength,
    detail: `Median duration rose ${Math.round(drift * 100)}% from ${Math.round(before)}ms to ${Math.round(after)}ms`,
  };
}

/**
 * The flake forecast: tests that passed on their first attempt in the latest
 * base-branch run but whose recent history there is trending unstable.
 * Deterministic and advisory; it never touches a verdict.
 */
export function forecastAtRisk(runs: TestRun[], config: ForecastConfig, options: ForecastOptions = {}): AtRiskTest[] {
  if (config.maxTests <= 0) return [];
  const baseBranch = options.baseBranch ?? DEFAULT_BASE_BRANCH;
  const base = runs.filter((r) => r.branch === baseBranch);
  const latest = base.reduce<TestRun | undefined>((a, r) => (!a || r.startedAt > a.startedAt ? r : a), undefined);
  if (!latest) return [];
  const excluded = new Set(options.exclude ?? []);
  const histories = testHistories(base);
  const recency = (age: number) => Math.pow(0.5, age / config.halfLifeRuns);
  const minRuns = Math.max(3, config.minRuns);

  const atRisk: AtRiskTest[] = [];
  for (const result of latest.results) {
    if (excluded.has(result.testId) || result.status !== 'passed' || result.attempts.length > 1) continue;
    const history = histories.get(result.testId);
    if (!history) continue;
    const outcomes = onBaseBranch(history, { baseBranch }).outcomes
      .filter((o) => o.status !== 'skipped')
      .slice(-config.lookbackRuns);
    if (outcomes.length < minRuns) continue;

    let survival = 1;
    const reasons: AtRiskTest['reasons'] = [];
    for (const s of [outcomeInstability(outcomes, recency, config), retryTrend(outcomes, recency), durationVariance(outcomes, config), durationDrift(outcomes, config)]) {
      if (!s) continue;
      const contribution = CAP[s.signal] * s.strength;
      survival *= 1 - contribution;
      const weight = round2(contribution);
      if (weight >= MIN_REASON_WEIGHT) reasons.push({ signal: s.signal, detail: s.detail, weight });
    }
    const risk = round2(1 - survival);
    if (risk < config.threshold || reasons.length === 0) continue;
    reasons.sort((a, b) => b.weight - a.weight || SIGNAL_ORDER.indexOf(a.signal) - SIGNAL_ORDER.indexOf(b.signal));
    atRisk.push({ testId: result.testId, title: result.title, file: result.file, risk, runs: outcomes.length, reasons });
  }
  atRisk.sort((a, b) => b.risk - a.risk || (a.testId < b.testId ? -1 : a.testId > b.testId ? 1 : 0));
  return atRisk.slice(0, config.maxTests);
}
