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

// --- novelty, resolved, reappearance ---
import { reconcileClusters, renderMarkdown, buildReport, analyzeWindow, RazoSource } from '../dist/index.js';
import { MemoryCodeContext } from '../dist/fakes.js';

const run = (id, day, branch = 'main') => ({
  id, sha: String(day).repeat(40), branch, source: 's',
  startedAt: `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`, finishedAt: `2026-09-${String(day).padStart(2, '0')}T00:05:00Z`, results: [],
});
const ctx = (runs, extra = {}) => ({ runs, baseBranch: 'main', resolveAfterRuns: 3, ...extra });

test('novelty: a cluster the store never saw is new, a known one is recurring', () => {
  const known = { ...base(), id: 'known', lastSeenAt: '2026-09-20T00:00:00Z' };
  const out = reconcileClusters([known], [{ ...base(), id: 'known', novelty: 'new' }, { ...base(), id: 'fresh', novelty: 'new' }], ctx([]));
  assert.equal(out.find((c) => c.id === 'known').novelty, 'recurring');
  assert.equal(out.find((c) => c.id === 'fresh').novelty, 'new');
});

test('resolved: a cluster absent for resolveAfterRuns base-branch runs after its last failure becomes resolved', () => {
  const gone = { ...base(), id: 'gone', state: 'acknowledged', lastSeenAt: '2026-09-10T00:05:00Z' };
  const twoLater = ctx([run('a', 11), run('b', 12)]);
  assert.equal(reconcileClusters([gone], [], twoLater).find((c) => c.id === 'gone').state, 'acknowledged', 'two runs are not enough');
  const threeLater = ctx([run('a', 11), run('b', 12), run('c', 13)]);
  assert.equal(reconcileClusters([gone], [], threeLater).find((c) => c.id === 'gone').state, 'resolved');
});

test('resolved: PR-branch runs and runs before the last failure do not count', () => {
  const gone = { ...base(), id: 'gone', state: 'new', lastSeenAt: '2026-09-10T00:05:00Z' };
  const mixed = ctx([run('old', 9), run('pr1', 11, 'feat/x'), run('pr2', 12, 'feat/x'), run('m', 13)]);
  assert.equal(reconcileClusters([gone], [], mixed).find((c) => c.id === 'gone').state, 'new');
});

test('a resolved cluster that fails again comes back as new, marked reopened', () => {
  const resolved = { ...base(), id: 'back', state: 'resolved', firstSeenAt: '2026-09-01T00:00:00Z' };
  const [out] = reconcileClusters([resolved], [{ ...base(), id: 'back' }], ctx([]));
  assert.equal(out.state, 'new');
  assert.equal(out.novelty, 'reopened');
  assert.equal(out.firstSeenAt, '2026-09-01T00:00:00Z', 'history is kept');
});

test('the report and the Markdown show days open and put ignored and flaky clusters in a compact section', async () => {
  const item = seed.report.items[0];
  const report = {
    ...seed.report,
    generatedAt: '2026-09-26T07:00:00Z',
    items: [
      { ...item, cluster: { ...item.cluster, firstSeenAt: '2026-09-23T07:00:00Z', novelty: 'recurring' } },
      { ...item, cluster: { ...item.cluster, id: 'ign', signature: 'ignored one', state: 'ignored' }, verdict: { ...item.verdict, clusterId: 'ign' } },
      { ...item, cluster: { ...item.cluster, id: 'flk', signature: 'flaky one', state: 'flaky', category: 'flaky' }, verdict: { ...item.verdict, clusterId: 'flk', category: 'flaky' } },
    ],
  };
  const md = renderMarkdown(report);
  const main = md.slice(0, md.indexOf('## Known'));
  const compact = md.slice(md.indexOf('## Known'));
  assert.match(main, /recurring · open for 3 days/);
  assert.doesNotMatch(main, /ignored one|flaky one/);
  assert.match(compact, /ignored one/);
  assert.match(compact, /flaky one/);
  assert.match(compact, /\(ignored\)|\(flaky\)/);
});

test('quarantine is proposed once a cluster was marked flaky quarantineSuggestAfter times', async () => {
  const runs = await new RazoSource(DEMO).fetchRuns(new Date(0));
  const items = await analyzeWindow(runs, new MemoryCodeContext(JSON.parse(fs.readFileSync(path.join(DEMO, 'commits.json'), 'utf8'))));
  const flaky = { ...items[0], cluster: { ...items[0].cluster, category: 'flaky' }, classification: { ...items[0].classification, category: 'flaky' } };
  const mark = (at) => ({ clusterId: flaky.cluster.id, action: 'mark-flaky', user: 'ana', at });
  const twice = buildReport({ items: [flaky], runs, window: { from: 'a', to: 'b' }, actions: new Map([[flaky.cluster.id, [mark('1'), mark('2')]]]), quarantineSuggestAfter: 3 });
  assert.deepEqual(twice.items[0].proposedActions, [{ type: 'mark-flaky' }]);
  const thrice = buildReport({ items: [flaky], runs, window: { from: 'a', to: 'b' }, actions: new Map([[flaky.cluster.id, [mark('1'), mark('2'), mark('3')]]]), quarantineSuggestAfter: 3 });
  assert.deepEqual(thrice.items[0].proposedActions, [{ type: 'quarantine' }]);
});

test('runTriage reports state-aware clusters: recurring on the second morning, still ignored when a person ignored it', async () => {
  const stateFile = path.join(tmp(), 'triage-state.json');
  const cfg = demoConfig(stateFile);
  const red = new Date('2026-08-04T07:00:00Z');
  const first = await runTriage(cfg, { now: red, since: parseDuration('2d', red), lookback: parseDuration('30d', red) });
  assert.ok(first.report.items.every((i) => i.cluster.novelty === 'new'));
  const store = new JsonFileStore(stateFile);
  const stale = (await store.loadClusters()).find((c) => c.category === 'stale-test');
  await store.saveClusters((await store.loadClusters()).map((c) => (c.id === stale.id ? { ...c, state: 'ignored' } : c)));
  const second = await runTriage(cfg, { now: new Date('2026-08-05T07:00:00Z'), since: parseDuration('3d', red), lookback: parseDuration('30d', red) });
  const again = second.report.items.find((i) => i.cluster.id === stale.id);
  assert.equal(again.cluster.novelty, 'recurring');
  assert.equal(again.cluster.state, 'ignored');
  assert.equal(again.cluster.firstSeenAt, stale.firstSeenAt);
});

// --- notifier failure, reopened ---
test('when a notifier fails, triage run fails and the state is not saved', async () => {
  const stateFile = path.join(tmp(), 'triage-state.json');
  const cfg = parseConfig({
    source: { plugin: 'razo-source', config: { dataDir: DEMO } },
    code: { plugin: 'commits-json', config: { path: path.join(DEMO, 'commits.json') } },
    notifiers: [{ plugin: 'markdown', config: { outDir: path.join(tmp(), 'ok') } }, { plugin: 'markdown', config: { outDir: '/dev/null/not-a-directory' } }],
    store: { plugin: 'json-file', config: { path: stateFile } },
  }, {});
  const red = new Date('2026-08-04T07:00:00Z');
  await assert.rejects(runTriage(cfg, { now: red, since: parseDuration('2d', red), lookback: parseDuration('30d', red) }), /notifier|ENOTDIR|not-a-directory/);
  assert.equal(fs.existsSync(stateFile), false, 'nothing was saved');
});

test('a resolved cluster that fails again is reopened, not new and recurring', () => {
  const resolved = { ...base(), id: 'back', state: 'resolved', firstSeenAt: '2026-09-01T00:00:00Z' };
  const [out] = reconcileClusters([resolved], [{ ...base(), id: 'back' }], ctx([]));
  assert.equal(out.novelty, 'reopened');
  assert.equal(out.state, 'new');
  assert.equal(out.firstSeenAt, '2026-09-01T00:00:00Z');
});

test('the Markdown highlights reopened clusters and lists them first', () => {
  const item = seed.report.items[0];
  const report = {
    ...seed.report,
    generatedAt: '2026-09-26T07:00:00Z',
    items: [
      { ...item, cluster: { ...item.cluster, id: 'plain', signature: 'plain one', novelty: 'new' } },
      { ...item, cluster: { ...item.cluster, id: 'back', signature: 'came back', novelty: 'reopened', firstSeenAt: '2026-09-01T07:00:00Z' } },
    ],
  };
  const md = renderMarkdown(report);
  assert.ok(md.indexOf('came back') < md.indexOf('plain one'), 'reopened first');
  assert.match(md, /## ⚠ reopened · stale-test · medium/);
  assert.match(md, /open for 25 days/);
  assert.match(md, /1 reopened/, 'the totals line counts it');
});
