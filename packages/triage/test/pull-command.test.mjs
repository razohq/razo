import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { runPull, parseConfig, STATE_ARTIFACT_NAME, STATE_SCHEMA_VERSION, JsonFileStore } from '../dist/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pull-cmd-'));
const zipOf = (entries) => Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([p, v]) => [p, strToU8(v)]))));

function fakeGitHub({ artifacts = [], zips = {} } = {}) {
  const calls = [];
  const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, arrayBuffer: async () => body });
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (/\/actions\/artifacts$/.test(u.pathname)) return ok({ total_count: artifacts.length, artifacts });
    const zip = zips[Number(u.pathname.match(/artifacts\/(\d+)\/zip$/)?.[1])];
    if (zip) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) };
    if (/\/actions\/runs$/.test(u.pathname)) return ok({ total_count: 0, workflow_runs: [] });
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ message: 'Not Found' }), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}

const configWith = (stateFile) => parseConfig({
  source: { plugin: 'razo-source', config: { dataDir: path.join(path.dirname(stateFile), 'data') } },
  code: { plugin: 'commits-json', config: { path: './commits.json' } },
  pull: { repo: 'o/r', token: 't' },
  store: { plugin: 'json-file', config: { path: stateFile } },
}, {});

test('an existing but invalid state artifact is an error, never a silent empty start', async () => {
  const stateFile = path.join(tmp(), 'triage-state.json');
  const { fetch } = fakeGitHub({
    artifacts: [{ id: 9, name: STATE_ARTIFACT_NAME, expired: false, created_at: '2026-09-26T07:00:00Z', workflow_run: { head_branch: 'main' } }],
    zips: { 9: zipOf({ 'triage-state.json': '{"schemaVersion": 42}' }) },
  });
  await assert.rejects(runPull(configWith(stateFile), { since: new Date(0), dataDir: tmp(), fetch }), /schema version 42/);
  assert.equal(fs.existsSync(stateFile), false);
});

test('--reset-state skips the artifact and starts from an empty state on purpose', async () => {
  const stateFile = path.join(tmp(), 'triage-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, clusters: [{ id: 'old' }], runs: [], actions: [] }));
  const { fetch, calls } = fakeGitHub({
    artifacts: [{ id: 9, name: STATE_ARTIFACT_NAME, expired: false, created_at: '2026-09-26T07:00:00Z', workflow_run: { head_branch: 'main' } }],
    zips: { 9: zipOf({ 'triage-state.json': '{"schemaVersion": 42}' }) },
  });
  const result = await runPull(configWith(stateFile), { since: new Date(0), dataDir: tmp(), fetch, resetState: true });
  assert.deepEqual(result.state, { restored: false, reset: true });
  assert.ok(!calls.some((u) => /\/actions\/artifacts/.test(u)), 'no state artifact call');
  assert.deepEqual(await new JsonFileStore(stateFile).loadClusters(), []);
});

test('no state artifact at all: empty state with a notice', async () => {
  const stateFile = path.join(tmp(), 'triage-state.json');
  const { fetch } = fakeGitHub();
  const lines = [];
  const result = await runPull(configWith(stateFile), { since: new Date(0), dataDir: tmp(), fetch, log: (l) => lines.push(l) });
  assert.deepEqual(result.state, { restored: false });
  assert.ok(lines.some((l) => /empty state/.test(l)));
});
