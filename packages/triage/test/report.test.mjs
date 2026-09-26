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
