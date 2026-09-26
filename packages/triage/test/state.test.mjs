import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeClusters, runTriage, parseConfig, parseDuration, JsonFileStore } from '../dist/index.js';
import { seed } from '../dist/contract.js';

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/razo-demo-pr-1');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'triage-state-'));
const base = () => structuredClone(seed.report.items[0].cluster);

test('mergeClusters keeps a previous cluster that is absent from this run, unchanged', () => {
  const ignored = { ...base(), id: 'gone', state: 'ignored' };
  const merged = mergeClusters([ignored], [base()]);
  assert.deepEqual(merged.find((c) => c.id === 'gone'), ignored);
  assert.equal(merged.length, 2);
});

test('mergeClusters preserves state, firstSeenAt and linkedIssue of a known cluster and takes the rest from this run', () => {
  const previous = { ...base(), state: 'acknowledged', firstSeenAt: '2026-09-01T00:00:00Z', linkedIssue: { tracker: 't', key: 'K-1', url: 'u', status: 'open' } };
  const current = { ...base(), state: 'new', firstSeenAt: '2026-09-26T00:00:00Z', lastSeenAt: '2026-09-26T00:00:00Z', category: 'regression', confidence: 'high', failures: [...base().failures, { runId: 'run-9', testId: 't', sha: 'x' }] };
  const [merged] = mergeClusters([previous], [current]);
  assert.equal(merged.state, 'acknowledged');
  assert.equal(merged.firstSeenAt, '2026-09-01T00:00:00Z');
  assert.deepEqual(merged.linkedIssue, previous.linkedIssue);
  assert.equal(merged.category, 'regression');
  assert.equal(merged.lastSeenAt, '2026-09-26T00:00:00Z');
  assert.equal(merged.failures.length, 3);
});

test('mergeClusters leaves an unknown cluster as this run produced it', () => {
  const fresh = { ...base(), id: 'fresh' };
  assert.deepEqual(mergeClusters([], [fresh]), [fresh]);
});

function demoConfig(stateFile) {
  return parseConfig({
    source: { plugin: 'razo-source', config: { dataDir: DEMO } },
    code: { plugin: 'commits-json', config: { path: path.join(DEMO, 'commits.json') } },
    store: { plugin: 'json-file', config: { path: stateFile } },
  }, {});
}

test('an ignored cluster absent from one run reappears in the next and is still ignored', async () => {
  const stateFile = path.join(tmp(), 'triage-state.json');
  const cfg = demoConfig(stateFile);
  const red = new Date('2026-08-04T07:00:00Z');
  await runTriage(cfg, { now: red, since: parseDuration('2d', red), lookback: parseDuration('30d', red) });
  const store = new JsonFileStore(stateFile);
  const clusters = await store.loadClusters();
  const stale = clusters.find((c) => c.category === 'stale-test');
  await store.saveClusters(clusters.map((c) => (c.id === stale.id ? { ...c, state: 'ignored' } : c)));

  // A window with no failures at all: the cluster is absent from this run.
  const quiet = new Date('2026-08-03T03:30:00Z');
  const empty = await runTriage(cfg, { now: quiet, since: parseDuration('1d', quiet), lookback: parseDuration('30d', quiet) });
  assert.equal(empty.report.items.length, 0);
  assert.equal((await store.loadClusters()).find((c) => c.id === stale.id)?.state, 'ignored', 'kept while absent');

  // The failure is back in the window: still ignored.
  await runTriage(cfg, { now: red, since: parseDuration('2d', red), lookback: parseDuration('30d', red) });
  assert.equal((await store.loadClusters()).find((c) => c.id === stale.id)?.state, 'ignored', 'kept when it reappears');
});

test('a state written with another signature algorithm version triggers an explicit warning', async () => {
  const { STATE_SCHEMA_VERSION } = await import('../dist/index.js');
  const stateFile = path.join(tmp(), 'triage-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, signatureVersion: 0, clusters: [{ ...base(), id: 'old' }], runs: [], actions: [] }));
  const lines = [];
  const red = new Date('2026-08-04T07:00:00Z');
  await runTriage(demoConfig(stateFile), { now: red, since: parseDuration('2d', red), lookback: parseDuration('30d', red), log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /signature algorithm/.test(l) && /will not be recognized/.test(l)), lines.join('\n'));
});
