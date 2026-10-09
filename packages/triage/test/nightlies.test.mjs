import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeWindow, buildReport, CommitsJsonCodeContext, DEFAULT_RULES, RazoSource, renderMarkdown } from '../dist/index.js';

// Real razo-demo main runs, 09-26 → 10-09: three red streaks (09-28, 10-04, 10-07), each reverted.
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/razo-demo-nightlies');
const BREAK = '09f567edefcd7cf1886d9c5d538486fb45e19d64'; // merge of razo-demo PR #8
const BEFORE = 'c799daa'; // last green main before it
const COMMIT = 'aabb49e'; // the commit PR #8 merged
const REVERT = '012a04b'; // merge of the revert, green again

// The scheduled morning of 2026-10-08 that ran after the revert: the window holds both red runs and the green one.
async function morningAfterRevert() {
  const runs = await new RazoSource(DIR).fetchRuns(new Date(0));
  const window = { since: new Date('2026-10-07T19:00:00Z'), until: new Date('2026-10-08T19:00:00Z') };
  const items = await analyzeWindow(runs, new CommitsJsonCodeContext(path.join(DIR, 'commits.json')), DEFAULT_RULES, window);
  const byTest = Object.fromEntries(items.map((i) => [i.cluster.failures[0].testId.split('::')[1], i]));
  return { runs, items, byTest };
}

test('a failure fixed inside the window keeps its range and the commit that broke it', async () => {
  const { items, byTest } = await morningAfterRevert();
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.ok(item.cluster.lastGreenSha?.startsWith(BEFORE), `${item.cluster.signature}: last green ${item.cluster.lastGreenSha}`);
    assert.equal(item.cluster.firstRedSha, BREAK);
    assert.ok(item.cluster.suspectCommits.some((s) => s.sha.startsWith(COMMIT)), `${item.cluster.signature}: suspects`);
  }
  const coupon = byTest['a valid coupon applies a discount'];
  assert.equal(coupon.classification.category, 'regression');
  assert.equal(coupon.classification.confidence, 'high');
  const order = byTest['placing the order confirms it'];
  assert.equal(order.classification.category, 'stale-test');
});

test('a failure fixed inside the window says when it went green again', async () => {
  const { items } = await morningAfterRevert();
  for (const item of items) {
    const history = item.classification.evidence.filter((e) => e.kind === 'history').map((e) => e.description);
    assert.ok(
      history.some((d) => d.includes(BREAK.slice(0, 7)) && d.includes(`green again since ${REVERT}`)),
      `${item.cluster.signature}: ${JSON.stringify(history)}`,
    );
  }
});

test('days open count from the start of the current failing streak, not from the first failure in the lookback', async () => {
  const { runs, items } = await morningAfterRevert();
  const breakRun = runs.find((r) => r.sha === BREAK && r.finishedAt < '2026-10-08');
  for (const item of items) {
    assert.ok(item.cluster.firstSeenAt < '2026-09-29', 'the first sighting is still the 09-28 streak');
    assert.equal(item.cluster.openSince, breakRun.finishedAt);
  }
  const markdown = renderMarkdown(buildReport({
    items, runs, window: { from: '2026-10-07T19:00:00Z', to: '2026-10-08T19:00:00Z' }, generatedAt: '2026-10-08T19:00:00Z',
  }));
  assert.doesNotMatch(markdown, /open for 10 days/);
  assert.match(markdown, /open for 0 days/);
});

test('a failure already green again proposes no issue and says so in the next step', async () => {
  const { runs, items } = await morningAfterRevert();
  const report = buildReport({ items, runs, window: { from: '2026-10-07T19:00:00Z', to: '2026-10-08T19:00:00Z' } });
  for (const { verdict, proposedActions } of report.items) {
    assert.deepEqual(proposedActions, [], verdict.category);
    assert.match(verdict.nextStep, new RegExp(`^Green again since ${REVERT}`), verdict.nextStep);
    assert.match(verdict.nextStep, new RegExp(COMMIT), 'the commit that broke it stays visible');
  }
});
