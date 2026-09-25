import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterFailures, failingTestIds, clusterIdOf } from '../dist/index.js';
import { seed } from '../dist/contract.js';

test('groups failed attempts by signature across runs', () => {
  const clusters = clusterFailures(seed.runs);
  const notFound = clusters.find((c) => c.signature.includes('not found'));
  assert.ok(notFound);
  assert.equal(notFound.id, clusterIdOf(notFound.signature));
  // run-2 has two failed attempts of the checkout test, run-3 one more.
  assert.deepEqual(notFound.failures.map((f) => f.runId), ['run-2', 'run-2', 'run-3']);
  assert.deepEqual(failingTestIds(notFound), ['tests/checkout.spec.ts::placing the order confirms it']);
});

test('a failed attempt of a test that later passed still forms a cluster', () => {
  const clusters = clusterFailures(seed.runs);
  const timeout = clusters.find((c) => c.signature.includes('timeout'));
  assert.ok(timeout, 'the retry-then-pass failure clusters too');
  assert.deepEqual(timeout.failures, [{ runId: 'run-2', testId: 'tests/cart.spec.ts::the cart lists both items', sha: seed.runs[1].sha }]);
});

test('first and last seen come from the runs finishedAt', () => {
  const notFound = clusterFailures(seed.runs).find((c) => c.signature.includes('not found'));
  assert.equal(notFound.firstSeenAt, seed.runs[1].finishedAt);
  assert.equal(notFound.lastSeenAt, seed.runs[2].finishedAt);
});

test('defaults are unknown/low/new/new with no suspects', () => {
  for (const c of clusterFailures(seed.runs)) {
    assert.equal(c.category, 'unknown');
    assert.equal(c.confidence, 'low');
    assert.equal(c.novelty, 'new');
    assert.equal(c.state, 'new');
    assert.deepEqual(c.suspectCommits, []);
  }
});

test('most recent cluster first, then the one with more failures', () => {
  const [first, second] = clusterFailures(seed.runs);
  assert.ok(first.lastSeenAt >= second.lastSeenAt);
  assert.ok(first.signature.includes('not found'));
});

test('runs are ordered by startedAt before grouping, whatever order they arrive in', () => {
  const shuffled = [seed.runs[2], seed.runs[0], seed.runs[1]];
  const notFound = clusterFailures(shuffled).find((c) => c.signature.includes('not found'));
  assert.deepEqual(notFound.failures.map((f) => f.runId), ['run-2', 'run-2', 'run-3']);
});

test('no failures, no clusters', () => {
  assert.deepEqual(clusterFailures([seed.runs[0]]), []);
});
