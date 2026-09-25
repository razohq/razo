import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeWindow, RazoSource } from '../dist/index.js';
import { MemoryCodeContext } from '../dist/fakes.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const DEMO = path.join(FIXTURES, 'razo-demo-pr-1');
const demoCode = () => new MemoryCodeContext(JSON.parse(fs.readFileSync(path.join(DEMO, 'commits.json'), 'utf8')));

test('razo-demo PR #1 end to end: Place order is stale-test/medium with the express-checkout suspect', async () => {
  const runs = await new RazoSource(DEMO).fetchRuns(new Date(0));
  const items = await analyzeWindow(runs, demoCode());
  assert.equal(items.length, 2);
  const byTest = Object.fromEntries(items.map((i) => [i.cluster.failures[0].testId.split('::')[1], i]));
  const order = byTest['placing the order confirms it'];
  assert.equal(order.classification.category, 'stale-test');
  assert.equal(order.classification.confidence, 'medium');
  assert.equal(order.cluster.category, 'stale-test');
  assert.equal(order.cluster.confidence, 'medium');
  assert.equal(order.cluster.suspectCommits.length, 1);
  assert.match(order.cluster.suspectCommits[0].message, /Express checkout/);
  assert.equal(order.cluster.lastGreenSha, runs[0].sha);
  assert.equal(order.cluster.firstRedSha, runs[1].sha);
  const cart = byTest['the cart lists both items'];
  // The Mouse row removal names no control the test drove (the table testid is untouched):
  // no suspect, and one prior green is not enough for regression.
  assert.equal(cart.classification.category, 'unknown');
  assert.deepEqual(cart.cluster.suspectCommits, []);
});

test('a window with no failures yields no items', async () => {
  const runs = await new RazoSource(DEMO).fetchRuns(new Date(0));
  assert.deepEqual(await analyzeWindow([runs[0]], new MemoryCodeContext([])), []);
});

test('baseBranch is passed through: on another branch the demo has no range and no suspects', async () => {
  const runs = await new RazoSource(DEMO).fetchRuns(new Date(0));
  const items = await analyzeWindow(runs, demoCode(), undefined, { baseBranch: 'release' });
  for (const item of items) {
    assert.deepEqual(item.range, {});
    assert.deepEqual(item.cluster.suspectCommits, []);
  }
});

test('review 4: a mixed cluster takes its range from a test that has one, not from the first test', async () => {
  const sha = (n) => String(n).repeat(40);
  const err = { message: 'expected 3 rows, got 2', signature: 'expected 3 rows, got 2' };
  const mk = (n, branch, spec) => ({
    id: `r${n}`, sha: sha(n), branch, source: 's', startedAt: `2026-01-0${n}T00:00:00Z`, finishedAt: `2026-01-0${n}T00:05:00Z`,
    results: Object.entries(spec).map(([testId, status]) => ({
      testId, title: testId.split('::')[1], file: testId.split('::')[0], status, durationMs: 1,
      attempts: [{ status, durationMs: 1, ...(status === 'failed' ? { error: err } : {}) }], ...(status === 'failed' ? { error: err } : {}),
    })),
  });
  // Test A fails only on a PR branch and appears first; test B has three greens on main then fails.
  const runs = [
    mk(1, 'main', { 'f::b': 'passed' }), mk(2, 'main', { 'f::b': 'passed' }), mk(3, 'main', { 'f::b': 'passed' }),
    mk(4, 'feat/x', { 'f::a': 'failed' }), mk(5, 'main', { 'f::b': 'failed' }),
  ];
  const commits = [
    { sha: sha(3), message: 'c3', author: 'x', date: '2026-01-03T00:00:00Z', files: [] },
    { sha: sha(5), message: 'c5', author: 'x', date: '2026-01-05T00:00:00Z', files: [{ filename: 'x.ts', patch: '+ nothing' }] },
  ];
  const [item] = await analyzeWindow(runs, new MemoryCodeContext(commits));
  assert.deepEqual(item.cluster.failures.map((f) => f.testId), ['f::a', 'f::b']);
  assert.deepEqual(item.range, { lastGreenSha: sha(3), firstRedSha: sha(5) });
  assert.equal(item.cluster.lastGreenSha, sha(3));
  // A is unknown (no main history), B is a regression: a tie, resolved to unknown, but B's
  // range and evidence are there, which is what a first-test-only range would have lost.
  assert.equal(item.classification.category, 'unknown');
  assert.ok(item.classification.evidence.some((e) => e.kind === 'sha-range'));
  assert.ok(item.classification.evidence.some((e) => e.kind === 'history' && /1 regression/.test(e.description)));
  assert.ok(item.classification.evidence.some((e) => e.kind === 'history' && e.description.includes(`before ${sha(5).slice(0, 7)}`)));
});

test('since: only failures at or after the window start form clusters, but history still sees the lookback', async () => {
  const runs = await new RazoSource(DEMO).fetchRuns(new Date(0));
  const [green, red] = runs;
  const afterRed = new Date(Date.parse(red.finishedAt) + 1);
  assert.deepEqual(await analyzeWindow(runs, demoCode(), undefined, { since: afterRed }), []);
  const items = await analyzeWindow(runs, demoCode(), undefined, { since: new Date(red.startedAt) });
  assert.equal(items.length, 2);
  const order = items.find((i) => i.cluster.failures[0].testId.endsWith('placing the order confirms it'));
  assert.equal(order.cluster.lastGreenSha, green.sha, 'the green run before the window still feeds the range');
});
