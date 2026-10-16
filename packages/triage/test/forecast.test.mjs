import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, forecastAtRisk } from '../dist/index.js';

const T = 'tests/login.spec.ts::signs in';
const CONFIG = DEFAULT_RULES.forecast;

/**
 * One run per entry, a day apart, oldest first. An entry is a status, or
 * `{ status, sha, retried, durationMs, branch, tests }` for anything else.
 */
function runs(entries, defaults = {}) {
  return entries.map((entry, i) => {
    const e = typeof entry === 'string' ? { status: entry } : entry;
    const { status = 'passed', sha = 'same', retried = false, durationMs = 1000, branch = 'main', tests = [T] } = { ...defaults, ...e };
    const day = new Date(Date.UTC(2026, 9, 1 + i));
    const attempts = retried
      ? [{ status: 'failed', durationMs }, { status, durationMs }]
      : [{ status, durationMs }];
    return {
      id: `run-${i}`, sha, branch, source: 'test',
      startedAt: day.toISOString(), finishedAt: new Date(day.getTime() + 60_000).toISOString(),
      results: tests.map((testId) => ({
        testId, title: testId.split('::')[1], file: testId.split('::')[0], status, attempts, durationMs,
      })),
    };
  });
}

const forecast = (r, config = {}, options = {}) => forecastAtRisk(r, { ...CONFIG, ...config }, options);
const repeat = (n, entry) => Array.from({ length: n }, () => entry);

test('a steady test that always passes is not at risk', () => {
  assert.deepEqual(forecast(runs(repeat(12, 'passed'))), []);
});

test('pass/fail flips on the same commit put a currently green test at risk', () => {
  const [item] = forecast(runs(['passed', 'failed', 'passed', 'failed', 'passed', 'passed', 'failed', 'passed']));
  assert.equal(item.testId, T);
  assert.equal(item.title, 'signs in');
  assert.equal(item.file, 'tests/login.spec.ts');
  assert.equal(item.runs, 8);
  assert.ok(item.risk >= CONFIG.threshold, `risk ${item.risk}`);
  assert.equal(item.reasons[0].signal, 'outcome-instability');
  assert.match(item.reasons[0].detail, /flipped 6 times in the last 8 runs, most recently this run/);
});

test('a regression that a commit broke and another fixed is not flakiness', () => {
  // Red from the commit that broke it until the commit that fixed it.
  const history = runs([
    ...repeat(4, { status: 'passed', sha: 'a' }),
    ...repeat(2, { status: 'failed', sha: 'b' }),
    ...repeat(4, { status: 'passed', sha: 'c' }),
  ]);
  assert.deepEqual(forecast(history), []);
});

test('a flip across a commit weighs crossShaFlipWeight of one on the same commit', () => {
  const pattern = ['passed', 'passed', 'failed', 'passed', 'passed', 'failed', 'passed'];
  const sameSha = forecast(runs(pattern), { threshold: 0.01 })[0];
  const newShaEachRun = forecast(runs(pattern.map((status, i) => ({ status, sha: `c${i}` }))), { threshold: 0.01 })[0];
  assert.ok(newShaEachRun.risk < sameSha.risk, `${newShaEachRun.risk} < ${sameSha.risk}`);
  const full = forecast(runs(pattern.map((status, i) => ({ status, sha: `c${i}` }))), { threshold: 0.01, crossShaFlipWeight: 1 })[0];
  assert.equal(full.risk, sameSha.risk, 'with weight 1 a commit change makes no difference');
});

test('recent retries put a test at risk even when every final status passed', () => {
  const [item] = forecast(runs([...repeat(6, 'passed'), { retried: true }, 'passed', { retried: true }, 'passed']));
  assert.equal(item.reasons[0].signal, 'retry-trend');
  assert.match(item.reasons[0].detail, /Retried in 2 of the last 10 runs, most recently 1 run ago/);
});

test('a median duration that keeps rising is reported as drift', () => {
  const history = runs([...repeat(6, { durationMs: 1000 }), ...repeat(6, { durationMs: 2600 })]);
  const [item] = forecast(history, { threshold: 0.01 });
  const drift = item.reasons.find((r) => r.signal === 'duration-drift');
  assert.ok(drift, JSON.stringify(item.reasons));
  assert.match(drift.detail, /Median duration rose 160% from 1000ms to 2600ms/);
});

test('a duration spread that widened is reported as variance', () => {
  const steady = repeat(6, { durationMs: 1000 });
  const erratic = [600, 1500, 700, 1600, 800, 1400].map((durationMs) => ({ durationMs }));
  const [item] = forecast(runs([...steady, ...erratic]), { threshold: 0.01 });
  assert.ok(item.reasons.some((r) => r.signal === 'duration-variance'), JSON.stringify(item.reasons));
});

test('durations of failed runs are left out: a timeout is not the test getting slower', () => {
  const history = runs([...repeat(10, { durationMs: 1000 }), { status: 'failed', durationMs: 30_000 }, ...repeat(3, { durationMs: 1000 })], { sha: 'x' });
  const item = forecast(history, { threshold: 0.01 })[0];
  assert.ok(!item || item.reasons.every((r) => !r.signal.startsWith('duration')), JSON.stringify(item?.reasons));
});

test('fewer than minRuns base-branch runs is not enough history', () => {
  const flipping = ['passed', 'failed', 'passed', 'failed', 'passed'];
  assert.equal(forecast(runs(flipping), { minRuns: 6 }).length, 0);
  assert.equal(forecast(runs(flipping), { minRuns: 5 }).length, 1);
});

test('only lookbackRuns of the newest base-branch runs count', () => {
  const oldFlips = ['passed', 'failed', 'passed', 'failed', 'passed', 'failed'];
  const history = runs([...oldFlips, ...repeat(10, 'passed')]);
  assert.equal(forecast(history, { lookbackRuns: 10, threshold: 0.01 }).length, 0);
  assert.equal(forecast(history, { lookbackRuns: 16, threshold: 0.01 }).length, 1);
});

test('a test that failed or needed a retry in the latest base run is not forecast: triage already reports it', () => {
  const flipping = ['passed', 'failed', 'passed', 'failed', 'passed', 'failed', 'passed'];
  assert.equal(forecast(runs([...flipping, 'failed'])).length, 0);
  assert.equal(forecast(runs([...flipping, { retried: true }])).length, 0);
  assert.equal(forecast(runs(flipping), {}, { exclude: [T] }).length, 0, 'tests already in a cluster are left out');
});

test('only base-branch runs feed the forecast', () => {
  const prFlips = ['failed', 'passed', 'failed', 'passed', 'failed'].map((status) => ({ status, branch: 'feat/x' }));
  const history = runs([...repeat(3, 'passed'), ...prFlips, ...repeat(3, 'passed')]);
  assert.deepEqual(forecast(history), []);
  assert.equal(forecast(history, {}, { baseBranch: 'feat/x' }).length, 0, 'the latest feat/x run failed');
});

test('a test missing from the latest base run is not forecast: it was renamed or deleted', () => {
  const OTHER = 'tests/cart.spec.ts::adds an item';
  const history = runs([
    ...['passed', 'failed', 'passed', 'failed', 'passed', 'failed', 'passed'].map((status) => ({ status, tests: [T, OTHER] })),
    { tests: [OTHER] },
  ]);
  assert.equal(forecast(history).some((i) => i.testId === T), false);
});

test('at-risk tests come riskiest first, at most maxTests, and maxTests 0 turns the forecast off', () => {
  const A = 'tests/a.spec.ts::a';
  const B = 'tests/b.spec.ts::b';
  const statuses = { [A]: ['passed', 'failed', 'passed', 'passed', 'passed', 'passed', 'passed'], [B]: ['passed', 'failed', 'passed', 'failed', 'passed', 'failed', 'passed'] };
  const history = statuses[A].map((_, i) => ({ id: `run-${i}`, sha: 'same', branch: 'main', source: 'test',
    startedAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), finishedAt: new Date(Date.UTC(2026, 9, 1 + i, 0, 1)).toISOString(),
    results: [A, B].map((testId) => ({ testId, title: testId, file: 'f', status: statuses[testId][i], attempts: [{ status: statuses[testId][i], durationMs: 1000 }], durationMs: 1000 })) }));
  assert.deepEqual(forecast(history, { threshold: 0.01 }).map((i) => i.testId), [B, A]);
  assert.deepEqual(forecast(history, { threshold: 0.01, maxTests: 1 }).map((i) => i.testId), [B]);
  assert.deepEqual(forecast(history, { threshold: 0.01, maxTests: 0 }), []);
});

test('the forecast is deterministic and its numbers are rounded for the report', () => {
  const history = runs(['passed', 'failed', 'passed', 'failed', 'passed', 'passed', 'failed', 'passed']);
  const [a] = forecast(history);
  const [b] = forecast(structuredClone(history).reverse());
  assert.deepEqual(a, b, 'run order does not matter');
  assert.equal(a.risk, Math.round(a.risk * 100) / 100);
  for (const r of a.reasons) assert.equal(r.weight, Math.round(r.weight * 100) / 100);
});

test('calibration: CI jitter on a short test is not variance or drift', () => {
  // A razo-demo test on main, 2026-09-26 → 10-01: always green, 108–256ms.
  const durations = [120, 134, 117, 198, 256, 166, 208, 108];
  assert.deepEqual(forecast(runs(durations.map((durationMs) => ({ durationMs })))), []);
  const slower = [120, 134, 117, 110, 330, 310, 340, 320];
  assert.deepEqual(forecast(runs(slower.map((durationMs) => ({ durationMs }))), { threshold: 0.01 }), [], 'a 200ms rise is still noise');
});
