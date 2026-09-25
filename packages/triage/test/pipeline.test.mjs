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
