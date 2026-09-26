import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testHistories, shaRange, stableBefore, retryFlip, sameShaFlips, isFailing, DEFAULT_BASE_BRANCH } from '../dist/index.js';
import { seed } from '../dist/contract.js';

const CHECKOUT = 'tests/checkout.spec.ts::placing the order confirms it';
const CART = 'tests/cart.spec.ts::the cart lists both items';
const [GREEN, RED] = [seed.runs[0].sha, seed.runs[1].sha];

const outcome = (sha, status, attempts = [{ status, durationMs: 1 }]) =>
  ({ runId: sha + status, sha, branch: 'main', finishedAt: '2026-01-01T00:00:00Z', status, attempts });
const history = (...outcomes) => ({ testId: 't', file: 'f', outcomes });

test('histories are per testId, ascending by run start', () => {
  const histories = testHistories([...seed.runs].reverse());
  assert.deepEqual(histories.get(CHECKOUT).outcomes.map((o) => o.runId), ['run-1', 'run-2', 'run-3']);
  assert.deepEqual(histories.get(CHECKOUT).outcomes.map((o) => o.status), ['passed', 'failed', 'failed']);
  assert.equal(histories.get(CART).file, 'tests/cart.spec.ts');
});

test('isFailing covers failed, timedOut and interrupted only', () => {
  assert.deepEqual(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].map(isFailing), [false, true, true, false, true]);
});

test('shaRange finds the last green before the current red streak', () => {
  const h = testHistories(seed.runs).get(CHECKOUT);
  assert.deepEqual(shaRange(h), { lastGreenSha: GREEN, firstRedSha: RED });
});

test('shaRange is empty when the test currently passes', () => {
  assert.deepEqual(shaRange(testHistories(seed.runs).get(CART)), {});
});

test('shaRange without a prior green has firstRedSha only', () => {
  assert.deepEqual(shaRange(history(outcome('b', 'failed'), outcome('c', 'failed'))), { firstRedSha: 'b' });
});

test('a skipped outcome inside the streak neither breaks it nor counts as green', () => {
  const h = history(outcome('a', 'passed'), outcome('b', 'failed'), outcome('c', 'skipped'), outcome('d', 'failed'));
  assert.deepEqual(shaRange(h), { lastGreenSha: 'a', firstRedSha: 'b' });
});

test('a trailing skipped outcome does not hide the streak', () => {
  const h = history(outcome('a', 'passed'), outcome('b', 'failed'), outcome('c', 'skipped'));
  assert.deepEqual(shaRange(h), { lastGreenSha: 'a', firstRedSha: 'b' });
});

test('a skipped outcome right before the streak does not break stableBefore', () => {
  const h = history(outcome('a', 'passed'), outcome('b', 'passed'), outcome('c', 'passed'), outcome('d', 'skipped'), outcome('e', 'failed'));
  assert.equal(stableBefore(h, 3), true);
  assert.equal(shaRange(h).lastGreenSha, 'c');
});

test('stableBefore needs n passed outcomes right before the streak', () => {
  const h = history(outcome('a', 'passed'), outcome('b', 'passed'), outcome('c', 'passed'), outcome('d', 'failed'));
  assert.equal(stableBefore(h, 3), true);
  assert.equal(stableBefore(h, 4), false);
  assert.equal(stableBefore(history(outcome('a', 'failed'), outcome('b', 'passed'), outcome('c', 'failed')), 2), false);
  assert.equal(stableBefore(history(outcome('a', 'passed'), outcome('b', 'passed')), 1), false, 'no streak, not stable-before-anything');
});

test('retryFlip returns the outcome that failed then passed', () => {
  const h = testHistories(seed.runs).get(CART);
  assert.equal(retryFlip(h)?.runId, 'run-2');
  assert.equal(retryFlip(testHistories(seed.runs).get(CHECKOUT)), undefined);
});

test('sameShaFlips counts alternations without a sha change inside the lookback', () => {
  const h = history(outcome('a', 'passed'), outcome('a', 'failed'), outcome('a', 'passed'), outcome('b', 'failed'), outcome('b', 'failed'));
  assert.equal(sameShaFlips(h, 10), 2);
  assert.equal(sameShaFlips(h, 2), 0);
});

// --- baseBranch ---
const branchRun = (id, sha, branch, status, day) => ({
  id, sha, branch, source: 's', startedAt: `2026-01-${day}T00:00:00Z`, finishedAt: `2026-01-${day}T00:05:00Z`,
  results: [{ testId: 'f::t', title: 't', file: 'f', status, durationMs: 1, attempts: [{ status, durationMs: 1 }] }],
});
const interleaved = [
  branchRun('m1', 'a', 'main', 'passed', '01'),
  branchRun('p1', 'p', 'feat/x', 'failed', '02'),
  branchRun('m2', 'b', 'main', 'passed', '03'),
  branchRun('p2', 'q', 'feat/x', 'passed', '04'),
  branchRun('m3', 'c', 'main', 'passed', '05'),
  branchRun('m4', 'd', 'main', 'failed', '06'),
  branchRun('p3', 'r', 'feat/y', 'passed', '07'),
];

test('outcomes carry their branch', () => {
  const h = testHistories(interleaved).get('f::t');
  assert.deepEqual(h.outcomes.map((o) => o.branch), ['main', 'feat/x', 'main', 'feat/x', 'main', 'main', 'feat/y']);
});

test('shaRange ignores PR runs interleaved with main: a green PR run after a red main does not end the streak', () => {
  const h = testHistories(interleaved).get('f::t');
  assert.deepEqual(shaRange(h), { lastGreenSha: 'c', firstRedSha: 'd' });
});

test('stableBefore counts only base-branch runs', () => {
  const h = testHistories(interleaved).get('f::t');
  assert.equal(stableBefore(h, 3), true, 'm1, m2, m3 passed on main; the failing PR run in between does not count');
  assert.equal(stableBefore(h, 4), false);
});

test('baseBranch is configurable and defaults to main', () => {
  const h = testHistories(interleaved).get('f::t');
  assert.deepEqual(shaRange(h, { baseBranch: 'feat/x' }), {}, 'on feat/x the last run passed');
  assert.deepEqual(shaRange(h, { baseBranch: 'main' }), shaRange(h));
  assert.deepEqual(shaRange(h, { baseBranch: 'release' }), {}, 'no runs on that branch, no range');
  assert.equal(DEFAULT_BASE_BRANCH, 'main');
});

test('sameShaFlips keeps seeing every branch', () => {
  const runs = [
    branchRun('p1', 's', 'feat/x', 'passed', '01'),
    branchRun('p2', 's', 'feat/x', 'failed', '02'),
    branchRun('p3', 's', 'feat/x', 'passed', '03'),
  ];
  assert.equal(sameShaFlips(testHistories(runs).get('f::t'), 10), 2);
});
