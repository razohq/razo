import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classify, DEFAULT_RULES, isEnvironmentSignature, isLocatorSignature,
  clusterFailures, testHistories, shaRange, RazoSource, errorSignature,
} from '../dist/index.js';
import { seed } from '../dist/contract.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

function inputFor(runs, pick, extra = {}) {
  const clusters = clusterFailures(runs);
  const cluster = clusters.find(pick);
  assert.ok(cluster, 'cluster found');
  const histories = testHistories(runs);
  const range = shaRange(histories.get(cluster.failures[0].testId));
  return { cluster, clusters, runs, histories, range, commitsInRange: [], suspects: [], unevaluable: [], ...extra };
}

const sha = (n) => String(n).repeat(40);
const err = (message) => ({ message, signature: errorSignature(message) });
const ASSERTION = err('expected 3 rows, got 2');
const LOCATOR = err("locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByTestId('place-order')");

/** One run with several tests; `spec` is { testId: { status, attempts?, error?, extra? } }. */
function run(n, spec, branch = 'main') {
  const day = String(n).padStart(2, '0');
  return {
    id: `r${n}`, sha: sha(n), branch, source: 's',
    startedAt: `2026-01-${day}T00:00:00Z`, finishedAt: `2026-01-${day}T00:05:00Z`,
    results: Object.entries(spec).map(([testId, s]) => ({
      testId, title: testId.split('::')[1], file: testId.split('::')[0], status: s.status, durationMs: 1,
      attempts: s.attempts ?? [{ status: s.status, durationMs: 1, ...(s.error ? { error: s.error } : {}) }],
      ...(s.error && s.status !== 'passed' ? { error: s.error } : {}),
      ...(s.extra ?? {}),
    })),
  };
}
const passed = { status: 'passed' };
const failed = (error) => ({ status: 'failed', error });
const flip = (error) => ({ status: 'passed', attempts: [{ status: 'failed', durationMs: 1, error }, { status: 'passed', durationMs: 1 }] });

test('signature detectors', () => {
  assert.equal(isEnvironmentSignature(errorSignature('page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:9/cart')), true);
  assert.equal(isEnvironmentSignature(errorSignature('TimeoutError: page.goto: Timeout 30000ms exceeded navigating to http://localhost:3000/')), true);
  assert.equal(isEnvironmentSignature(errorSignature('Error: 503 Service Unavailable')), true);
  assert.equal(isEnvironmentSignature(errorSignature('expected 3 rows, got 2')), false);
  assert.equal(isLocatorSignature(LOCATOR.signature), true);
  assert.equal(isLocatorSignature(errorSignature("Error: strict mode violation: getByRole('button') resolved to 2 elements")), true);
  assert.equal(isLocatorSignature(errorSignature('expect(locator).toBeVisible() failed')), true);
  assert.equal(isLocatorSignature(errorSignature('expected 3 rows, got 2')), false);
});

test('a test that failed then passed on retry with the same sha is flaky/high', () => {
  const out = classify(inputFor(seed.runs, (c) => c.signature.includes('timeout')));
  assert.equal(out.category, 'flaky');
  assert.equal(out.confidence, 'high');
  assert.ok(out.evidence.some((e) => e.kind === 'retry'));
});

test('a test alternating on the same sha across runs is flaky/medium', () => {
  const runs = [run(1, { 'f::t': passed }), run(2, { 'f::t': failed(ASSERTION) }), run(3, { 'f::t': passed })];
  for (const r of runs) r.sha = sha(9);
  const out = classify(inputFor(runs, () => true));
  assert.equal(out.category, 'flaky');
  assert.equal(out.confidence, 'medium');
});

test('a locator failure whose suspect touches the control is stale-test/medium with commit and sha-range evidence', () => {
  const suspect = { sha: seed.commits[1].sha, message: seed.commits[1].message, author: 'ana', overlappingComponents: ['button "Place order"'], score: 1 };
  const out = classify(inputFor(seed.runs, (c) => c.signature.includes('not found'), { suspects: [suspect], commitsInRange: seed.commits.slice(1) }));
  assert.equal(out.category, 'stale-test');
  assert.equal(out.confidence, 'medium');
  assert.ok(out.evidence.some((e) => e.kind === 'commit' && e.description.includes(seed.commits[1].sha.slice(0, 7))));
  assert.ok(out.evidence.some((e) => e.kind === 'sha-range'));
});

test('healedLocators add stale-test evidence but never raise the confidence to high', () => {
  const runs = [
    run(1, { 'f::t': passed }), run(2, { 'f::t': passed }), run(3, { 'f::t': passed }),
    run(4, { 'f::t': { ...failed(LOCATOR), extra: { healedLocators: [{ from: '[data-testid="export-v0"]', to: 'role=button[name="Export"]' }] } } }),
  ];
  const out = classify(inputFor(runs, () => true));
  assert.equal(out.category, 'stale-test');
  assert.equal(out.confidence, 'medium');
  assert.ok(out.evidence.some((e) => e.kind === 'history' && /healed/.test(e.description)));
});

test('a locator failure with no suspect and no healing after one green is unknown/low', () => {
  const out = classify(inputFor(seed.runs, (c) => c.signature.includes('not found')));
  assert.equal(out.category, 'unknown');
  assert.equal(out.confidence, 'low');
});

test('an unevaluable file becomes commit evidence without changing the verdict', () => {
  const unevaluable = [{ sha: sha(4), filename: 'src/PlaceOrder.tsx', components: ['button "Place order"'], reason: 'no patch' }];
  const out = classify(inputFor(seed.runs, (c) => c.signature.includes('not found'), { unevaluable }));
  assert.equal(out.category, 'unknown');
  assert.ok(out.evidence.some((e) => e.kind === 'commit' && /no evaluable|unevaluable/.test(e.description) && e.description.includes('PlaceOrder.tsx')));
});

test('a non-locator failure after 3 stable greens is regression; high only with an overlapping suspect', () => {
  const runs = [run(1, { 'f::t': passed }), run(2, { 'f::t': passed }), run(3, { 'f::t': passed }), run(4, { 'f::t': failed(ASSERTION) }), run(5, { 'f::t': failed(ASSERTION) })];
  const commit = { sha: sha(4), message: 'm', author: 'a', date: '2026-01-04T00:00:00Z' };
  const medium = classify(inputFor(runs, () => true, { commitsInRange: [commit] }));
  assert.equal(medium.category, 'regression');
  assert.equal(medium.confidence, 'medium');
  const high = classify(inputFor(runs, () => true, { commitsInRange: [commit], suspects: [{ sha: sha(4), message: 'm', author: 'a', overlappingComponents: ['table "Cart"'], score: 1 }] }));
  assert.equal(high.confidence, 'high');
});

test('a cluster with no prior history is never a regression', () => {
  const out = classify(inputFor([run(1, { 'f::t': failed(ASSERTION) })], () => true));
  assert.notEqual(out.category, 'regression');
  assert.equal(out.confidence, 'low');
});

test('baseBranch: PR runs do not make a main streak look stable', () => {
  const runs = [
    run(1, { 'f::t': passed }), run(2, { 'f::t': passed }, 'feat/x'), run(3, { 'f::t': passed }, 'feat/x'),
    run(4, { 'f::t': failed(ASSERTION) }),
  ];
  const histories = testHistories(runs);
  const cluster = clusterFailures(runs)[0];
  const input = { cluster, clusters: [cluster], runs, histories, range: shaRange(histories.get('f::t')), commitsInRange: [], suspects: [], unevaluable: [] };
  assert.notEqual(classify(input).category, 'regression', 'only one green on main');
  assert.equal(classify({ ...input, baseBranch: 'feat/x', range: shaRange(histories.get('f::t'), { baseBranch: 'feat/x' }) }).category, 'unknown');
});

test('mixed cluster, unanimous category: that category with the lowest confidence among its tests', () => {
  const runs = [
    run(1, { 'f::a': passed, 'f::b': passed }), run(2, { 'f::a': passed, 'f::b': failed(ASSERTION) }),
    run(3, { 'f::a': flip(ASSERTION), 'f::b': passed }),
  ];
  runs[1].sha = sha(1); runs[2].sha = sha(1); // same sha: b alternates, a flips on retry
  const out = classify(inputFor(runs, () => true));
  assert.equal(out.category, 'flaky');
  assert.equal(out.confidence, 'medium', 'a is high, b is medium; unanimity takes the lowest');
});

test('mixed cluster, majority: majority category, confidence one level below its lowest, mix as evidence', () => {
  const runs = [
    run(1, { 'f::a': passed, 'f::b': passed, 'f::c': passed }),
    run(2, { 'f::a': passed, 'f::b': failed(ASSERTION), 'f::c': passed }),
    run(3, { 'f::a': passed, 'f::b': passed, 'f::c': passed }),
    run(4, { 'f::a': flip(ASSERTION), 'f::b': failed(ASSERTION), 'f::c': failed(ASSERTION) }),
  ];
  runs[1].sha = sha(1); runs[2].sha = sha(1); // b alternates on the same sha → flaky/medium; a flips on retry → flaky/high
  const out = classify(inputFor(runs, () => true));
  assert.equal(out.category, 'flaky', '2 flaky vs 1 regression');
  assert.equal(out.confidence, 'low', 'lowest of the majority is medium, one level below is low');
  const mix = out.evidence.find((e) => e.kind === 'history' && /flaky/.test(e.description) && /regression/.test(e.description));
  assert.ok(mix, 'the mix is spelled out as evidence');
});

test('mixed cluster, tie: unknown/low with the mix as evidence', () => {
  const runs = [
    run(1, { 'f::a': passed, 'f::b': passed }), run(2, { 'f::a': passed, 'f::b': passed }), run(3, { 'f::a': passed, 'f::b': passed }),
    run(4, { 'f::a': flip(ASSERTION), 'f::b': failed(ASSERTION) }),
  ];
  const out = classify(inputFor(runs, () => true));
  assert.equal(out.category, 'unknown');
  assert.equal(out.confidence, 'low');
  assert.ok(out.evidence.some((e) => e.kind === 'history' && /flaky/.test(e.description) && /regression/.test(e.description)));
});

test('synthetic-environment: five files with connection errors in one run is environment/high', async () => {
  const runs = await new RazoSource(path.join(FIXTURES, 'synthetic-environment')).fetchRuns(new Date(0));
  const out = classify(inputFor(runs, () => true));
  assert.equal(out.category, 'environment');
  assert.equal(out.confidence, 'high');
});

test('environment needs minFiles distinct files; below it the rule does not fire', async () => {
  const runs = await new RazoSource(path.join(FIXTURES, 'synthetic-environment')).fetchRuns(new Date(0));
  const out = classify(inputFor(runs, () => true), { ...DEFAULT_RULES, env: { windowMinutes: 10, minFiles: 50 } });
  assert.notEqual(out.category, 'environment');
});

test('synthetic-flaky: the retried test is flaky/high', async () => {
  const runs = await new RazoSource(path.join(FIXTURES, 'synthetic-flaky')).fetchRuns(new Date(0));
  const out = classify(inputFor(runs, () => true));
  assert.equal(out.category, 'flaky');
  assert.equal(out.confidence, 'high');
});
