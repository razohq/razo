import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeWindow, buildReport, RazoSource } from '../dist/index.js';
import { MemoryCodeContext } from '../dist/fakes.js';

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/razo-demo-pr-1');

async function demo() {
  const runs = await new RazoSource(DEMO).fetchRuns(new Date(0));
  const code = new MemoryCodeContext(JSON.parse(fs.readFileSync(path.join(DEMO, 'commits.json'), 'utf8')));
  const items = await analyzeWindow(runs, code);
  return { runs, items };
}

test('totals count distinct tests, cluster failures and clusters', async () => {
  const { runs, items } = await demo();
  const report = buildReport({ items, runs, window: { from: runs[0].startedAt, to: runs[1].finishedAt }, generatedAt: '2026-09-25T07:00:00Z' });
  assert.equal(report.generatedAt, '2026-09-25T07:00:00Z');
  assert.deepEqual(report.totals, { tests: 4, failures: 2, clusters: 2 });
  assert.equal(report.items.length, 2);
  for (const item of report.items) {
    assert.equal(item.verdict.clusterId, item.cluster.id);
    assert.equal(item.verdict.origin, 'rules');
    assert.ok(item.verdict.nextStep.length > 0);
  }
});

test('stale-test proposes an issue draft carrying the signature, the tests and the suspect', async () => {
  const { runs, items } = await demo();
  const report = buildReport({ items, runs, window: { from: runs[0].startedAt, to: runs[1].finishedAt } });
  const order = report.items.find((i) => i.cluster.category === 'stale-test');
  assert.equal(order.proposedActions.length, 1);
  const [action] = order.proposedActions;
  assert.equal(action.type, 'create-issue');
  assert.equal(action.draft.signature, order.cluster.signature);
  assert.match(action.draft.title, /^\[triage\] stale-test: placing the order confirms it$/);
  assert.match(action.draft.body, /Express checkout/);
  assert.match(action.draft.body, /placing the order confirms it/);
  assert.deepEqual(action.draft.labels, ['triage', 'stale-test']);
  assert.match(order.verdict.nextStep, /Express checkout/);
});

test('unknown proposes nothing; flaky proposes mark-flaky; environment proposes ignore', async () => {
  const { runs, items } = await demo();
  const report = buildReport({ items, runs, window: { from: runs[0].startedAt, to: runs[1].finishedAt } });
  const cart = report.items.find((i) => i.cluster.category === 'unknown');
  assert.deepEqual(cart.proposedActions, []);
  const fake = (category) => ({ ...items[0], cluster: { ...items[0].cluster, category }, classification: { ...items[0].classification, category } });
  const mixed = buildReport({ items: [fake('flaky'), fake('environment')], runs, window: { from: runs[0].startedAt, to: runs[1].finishedAt } });
  assert.deepEqual(mixed.items[0].proposedActions, [{ type: 'mark-flaky' }]);
  assert.deepEqual(mixed.items[1].proposedActions, [{ type: 'ignore' }]);
});

test('generatedAt defaults to now and the window is kept verbatim', async () => {
  const { runs, items } = await demo();
  const before = Date.now();
  const report = buildReport({ items, runs, window: { from: 'a', to: 'b' } });
  assert.ok(Date.parse(report.generatedAt) >= before - 1000);
  assert.deepEqual(report.window, { from: 'a', to: 'b' });
});

test('totals.failures counts only failures of the runs in the window, even when clusters carry older ones', async () => {
  const { runs, items } = await demo();
  const [green, red] = runs;
  const older = { runId: 'ancient', testId: items[0].cluster.failures[0].testId, sha: 'x'.repeat(40) };
  const withHistory = items.map((i) => ({ ...i, cluster: { ...i.cluster, failures: [older, ...i.cluster.failures] } }));
  const report = buildReport({ items: withHistory, runs: [red], window: { from: red.startedAt, to: red.finishedAt } });
  assert.equal(report.totals.failures, 2, 'two failures in the red run; the ancient ones are history');
  assert.equal(report.totals.tests, 4);
  const all = buildReport({ items: withHistory, runs: [green, red], window: { from: green.startedAt, to: red.finishedAt } });
  assert.equal(all.totals.failures, 2);
});

test('a proposed issue carries the link where a person creates it, when a tracker offers one', async () => {
  const { runs, items } = await demo();
  const report = buildReport({ items, runs, window: { from: runs[0].startedAt, to: runs[1].finishedAt }, issueUrl: (draft) => `https://example/new?title=${encodeURIComponent(draft.title)}` });
  const [action] = report.items.find((i) => i.cluster.category === 'stale-test').proposedActions;
  assert.match(action.draft.url, /^https:\/\/example\/new\?title=%5Btriage%5D/);
  const without = buildReport({ items, runs, window: { from: runs[0].startedAt, to: runs[1].finishedAt } });
  assert.equal(without.items.find((i) => i.cluster.category === 'stale-test').proposedActions[0].draft.url, undefined);
});

test('a cluster with an open issue proposes no new one and points at it', async () => {
  const { runs, items } = await demo();
  const stale = items.find((i) => i.classification.category === 'stale-test');
  stale.cluster.linkedIssue = { tracker: 'github', key: '#7', url: 'https://github.com/o/r/issues/7', status: 'open' };
  stale.cluster.state = 'ticketed';
  const report = buildReport({ items, runs, window: { from: runs[0].startedAt, to: runs[1].finishedAt } });
  const item = report.items.find((i) => i.cluster.id === stale.cluster.id);
  assert.deepEqual(item.proposedActions, []);
  assert.equal(item.verdict.nextStep, 'Tracked in #7 (https://github.com/o/r/issues/7); follow it there.');
});
