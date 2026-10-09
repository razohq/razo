import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pullDecisions, applyDecisions, reconcileClusters, parseConfig, runPull, runTriage, JsonFileStore,
} from '../dist/index.js';
import { MemoryStore } from '../dist/fakes.js';
import { seed } from '../dist/contract.js';

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/razo-demo-pr-1');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'triage-decisions-'));
const base = () => structuredClone(seed.report.items[0].cluster);
const decision = (id, clusterId, action, at) => ({ id, clusterId, action, at });

/** A decision feed that answers from a list, filtering by `since` like a real destination. */
function fakeFeed(decisions, { status = 200, body } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const since = Date.parse(new URL(url).searchParams.get('since'));
    const payload = body ?? { decisions: decisions.filter((d) => Date.parse(d.at) >= since) };
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { fetch, calls };
}

const FEED = { url: 'https://razo.ar/api/triage/decisions', token: 'rz_feed' };

test('pullDecisions asks the feed from the epoch with the bearer token and records every decision', async () => {
  const store = new MemoryStore();
  const feed = fakeFeed([decision('d1', 'c1', 'ignore', '2026-10-08T10:00:00.000Z'), decision('d2', 'c2', 'acknowledge', '2026-10-08T10:01:00.000Z')]);
  const result = await pullDecisions({ ...FEED, store, fetch: feed.fetch });
  assert.equal(result.recorded, 2);
  const { url, init } = feed.calls[0];
  assert.equal(new URL(url).searchParams.get('since'), '1970-01-01T00:00:00.000Z');
  assert.equal(init.headers.Authorization, 'Bearer rz_feed');
  assert.deepEqual((await store.actionsFor('c1')).map((a) => [a.id, a.action, a.user, a.at]), [['d1', 'ignore', 'razo.ar', '2026-10-08T10:00:00.000Z']]);
});

test('a second pull asks from the latest recorded decision and does not record the same id twice', async () => {
  const store = new MemoryStore();
  const feed = fakeFeed([decision('d1', 'c1', 'ignore', '2026-10-08T10:00:00.000Z'), decision('d2', 'c2', 'acknowledge', '2026-10-08T10:01:00.000Z')]);
  await pullDecisions({ ...FEED, store, fetch: feed.fetch });
  const again = await pullDecisions({ ...FEED, store, fetch: feed.fetch });
  assert.equal(new URL(feed.calls[1].url).searchParams.get('since'), '2026-10-08T10:01:00.000Z');
  assert.equal(again.recorded, 0);
  assert.equal((await store.listActions()).length, 2);
});

test('an action the engine does not know is skipped with a warning, not recorded', async () => {
  const store = new MemoryStore();
  const lines = [];
  const feed = fakeFeed([decision('d1', 'c1', 'snooze', '2026-10-08T10:00:00.000Z')]);
  const result = await pullDecisions({ ...FEED, store, fetch: feed.fetch, log: (l) => lines.push(l) });
  assert.equal(result.recorded, 0);
  assert.ok(lines.some((l) => /snooze/.test(l)));
});

test('a non-2xx answer fails the pull naming the status', async () => {
  const feed = fakeFeed([], { status: 401, body: { error: 'unauthorized' } });
  await assert.rejects(pullDecisions({ ...FEED, store: new MemoryStore(), fetch: feed.fetch }), /401/);
});

test('a malformed body fails the pull instead of recording half of it', async () => {
  const store = new MemoryStore();
  const feed = fakeFeed([], { body: { decisions: [decision('d1', 'c1', 'ignore', '2026-10-08T10:00:00.000Z'), { id: 'd2' }] } });
  await assert.rejects(pullDecisions({ ...FEED, store, fetch: feed.fetch }), /decisions\[1\]/);
  assert.deepEqual(await store.listActions(), []);
});

const act = (clusterId, action, at) => ({ clusterId, action, user: 'razo.ar', at });

test('applyDecisions maps each decision to a state; the latest one wins', () => {
  const clusters = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...base(), id, state: 'new' }));
  const actions = [
    act('a', 'ignore', '2026-10-08T10:00:00Z'),
    act('b', 'mark-flaky', '2026-10-08T10:00:00Z'),
    act('c', 'quarantine', '2026-10-08T10:00:00Z'),
    act('d', 'acknowledge', '2026-10-08T10:00:00Z'),
    act('e', 'acknowledge', '2026-10-08T10:00:00Z'),
    act('e', 'ignore', '2026-10-08T11:00:00Z'),
  ];
  const states = Object.fromEntries(applyDecisions(clusters, actions).map((c) => [c.id, c.state]));
  assert.deepEqual(states, { a: 'ignored', b: 'flaky', c: 'flaky', d: 'acknowledged', e: 'ignored' });
});

test('applyDecisions never overrides resolved or ticketed clusters', () => {
  const clusters = [{ ...base(), id: 'r', state: 'resolved' }, { ...base(), id: 't', state: 'ticketed' }];
  const out = applyDecisions(clusters, [act('r', 'ignore', '2026-10-08T10:00:00Z'), act('t', 'acknowledge', '2026-10-08T10:00:00Z')]);
  assert.deepEqual(out.map((c) => c.state), ['resolved', 'ticketed']);
});

test('reconcile stamps reopenedAt; an ignore survives the reopen, an older acknowledge does not', () => {
  const previous = ['ign', 'ack', 'late'].map((id) => ({ ...base(), id, state: 'resolved', lastSeenAt: '2026-10-01T03:00:00Z' }));
  const current = ['ign', 'ack', 'late'].map((id) => ({ ...base(), id, state: 'new', lastSeenAt: '2026-10-09T03:00:00Z' }));
  const reconciled = reconcileClusters(previous, current, { runs: [], baseBranch: 'main', resolveAfterRuns: 3 });
  assert.ok(reconciled.every((c) => c.novelty === 'reopened' && c.reopenedAt === '2026-10-09T03:00:00Z'));
  const out = applyDecisions(reconciled, [
    act('ign', 'ignore', '2026-09-30T10:00:00Z'),
    act('ack', 'acknowledge', '2026-09-30T10:00:00Z'),
    act('late', 'acknowledge', '2026-10-09T08:00:00Z'),
  ]);
  assert.deepEqual(Object.fromEntries(out.map((c) => [c.id, c.state])), { ign: 'ignored', ack: 'new', late: 'acknowledged' });
});

test('config: decisions takes a url and a token', () => {
  const cfg = parseConfig({
    source: { plugin: 'razo-source' }, code: { plugin: 'commits-json' },
    decisions: { url: 'https://razo.ar/api/triage/decisions', token: '${FEED_TOKEN}' },
  }, { FEED_TOKEN: 'rz_1' });
  assert.deepEqual(cfg.decisions, { url: 'https://razo.ar/api/triage/decisions', token: 'rz_1' });
  assert.throws(() => parseConfig({ source: { plugin: 'x' }, code: { plugin: 'y' }, decisions: { url: 'https://x' } }, {}), /decisions: .*token/);
  assert.throws(() => parseConfig({ source: { plugin: 'x' }, code: { plugin: 'y' }, decisions: { url: 'ftp://x', token: 't' } }, {}), /decisions: .*http/);
});

function noArtifactsGitHub() {
  return async (url) => {
    const u = new URL(url);
    const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
    if (/\/actions\/artifacts$/.test(u.pathname)) return ok({ total_count: 0, artifacts: [] });
    if (/\/actions\/runs$/.test(u.pathname)) return ok({ total_count: 0, workflow_runs: [] });
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
}

test('triage pull records the feed into the store after restoring the state', async () => {
  const dir = tmp();
  const stateFile = path.join(dir, 'triage-state.json');
  const github = noArtifactsGitHub();
  const feed = fakeFeed([decision('d1', 'c1', 'ignore', '2026-10-08T10:00:00.000Z')]);
  const fetch = (url, init) => (url.startsWith('https://razo.ar/') ? feed.fetch(url, init) : github(url, init));
  const config = parseConfig({
    source: { plugin: 'razo-source', config: { dataDir: path.join(dir, 'data') } },
    code: { plugin: 'commits-json', config: { path: './commits.json' } },
    pull: { repo: 'o/r', token: 't' },
    store: { plugin: 'json-file', config: { path: stateFile } },
    decisions: FEED,
  }, {});
  const result = await runPull(config, { since: new Date(0), dataDir: path.join(dir, 'data'), fetch });
  assert.equal(result.decisions.recorded, 1);
  assert.equal((await new JsonFileStore(stateFile).actionsFor('c1'))[0].action, 'ignore');
});

test('triage pull refuses a decisions section without a json-file store', async () => {
  const config = parseConfig({
    source: { plugin: 'razo-source' }, code: { plugin: 'commits-json' },
    pull: { repo: 'o/r', token: 't' }, decisions: FEED,
  }, {});
  await assert.rejects(runPull(config, { since: new Date(0), dataDir: tmp(), fetch: noArtifactsGitHub() }), /decisions need a json-file store/);
});

test('triage run applies recorded decisions to the clusters it saves and reports', async () => {
  const stateFile = path.join(tmp(), 'triage-state.json');
  const config = parseConfig({
    source: { plugin: 'razo-source', config: { dataDir: DEMO } },
    code: { plugin: 'commits-json', config: { path: path.join(DEMO, 'commits.json') } },
    store: { plugin: 'json-file', config: { path: stateFile } },
  }, {});
  const opts = { now: new Date('2026-12-31T00:00:00Z'), since: new Date(0), lookback: new Date(0) };
  const first = await runTriage(config, opts);
  const target = first.report.items[0].cluster.id;
  await new JsonFileStore(stateFile).recordAction({ id: 'd1', clusterId: target, action: 'ignore', user: 'razo.ar', at: '2026-12-31T00:00:00Z' });
  const second = await runTriage(config, { ...opts, now: new Date('2026-12-31T01:00:00Z') });
  assert.equal(second.report.items.find((i) => i.cluster.id === target).cluster.state, 'ignored');
  assert.equal((await new JsonFileStore(stateFile).loadClusters()).find((c) => c.id === target).state, 'ignored');
});
