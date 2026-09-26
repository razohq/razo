import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { GitHubApi, restoreState, STATE_ARTIFACT_NAME, STATE_SCHEMA_VERSION, JsonFileStore } from '../dist/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'state-artifact-'));
const stateJson = (runs) => JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, clusters: [], runs, actions: [] });
const zipOf = (entries) => Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([p, v]) => [p, strToU8(v)]))));

function fakeArtifacts(artifacts, zips) {
  const calls = [];
  const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, arrayBuffer: async () => body });
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (/\/actions\/artifacts$/.test(u.pathname)) {
      const name = u.searchParams.get('name');
      const list = artifacts.filter((a) => !name || a.name === name);
      return ok({ total_count: list.length, artifacts: list });
    }
    const zip = zips[Number(u.pathname.match(/artifacts\/(\d+)\/zip$/)?.[1])];
    if (zip) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) };
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ message: 'Not Found' }), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}

test('restoreState downloads the most recent non-expired state artifact into the store file', async () => {
  const file = path.join(tmp(), 'state', 'triage-state.json');
  const { fetch, calls } = fakeArtifacts(
    [
      { id: 1, name: STATE_ARTIFACT_NAME, expired: false, created_at: '2026-09-25T07:00:00Z' },
      { id: 2, name: STATE_ARTIFACT_NAME, expired: false, created_at: '2026-09-26T07:00:00Z' },
      { id: 3, name: STATE_ARTIFACT_NAME, expired: true, created_at: '2026-09-27T07:00:00Z' },
      { id: 4, name: 'razo-test-results-1-1', expired: false, created_at: '2026-09-28T07:00:00Z' },
    ],
    { 2: zipOf({ 'triage-state.json': stateJson([{ id: 'r2', generatedAt: '2026-09-26T07:00:00Z', window: { from: 'a', to: 'b' }, totals: { tests: 1, failures: 0, clusters: 0 }, durationMs: 1 }]) }) },
  );
  const result = await restoreState({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', file });
  assert.deepEqual(result, { restored: true, artifactId: 2, createdAt: '2026-09-26T07:00:00Z' });
  assert.ok(calls[0].includes(`name=${STATE_ARTIFACT_NAME}`), 'lists by name');
  assert.equal((await new JsonFileStore(file).lastTriageAt()).toISOString(), '2026-09-26T07:00:00.000Z');
});

test('restoreState reports when no state artifact exists and leaves the file untouched', async () => {
  const dir = tmp();
  const file = path.join(dir, 'triage-state.json');
  fs.writeFileSync(file, stateJson([]));
  const { fetch } = fakeArtifacts([{ id: 3, name: STATE_ARTIFACT_NAME, expired: true, created_at: '2026-09-27T07:00:00Z' }], {});
  const result = await restoreState({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', file });
  assert.deepEqual(result, { restored: false });
  assert.equal(fs.readFileSync(file, 'utf8'), stateJson([]));
});

test('restoreState refuses an artifact whose state has another schema version, keeping the local file', async () => {
  const dir = tmp();
  const file = path.join(dir, 'triage-state.json');
  fs.writeFileSync(file, stateJson([]));
  const { fetch } = fakeArtifacts(
    [{ id: 9, name: STATE_ARTIFACT_NAME, expired: false, created_at: '2026-09-26T07:00:00Z' }],
    { 9: zipOf({ 'triage-state.json': JSON.stringify({ schemaVersion: 42 }) }) },
  );
  await assert.rejects(restoreState({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', file }), /schema version 42/);
  assert.equal(fs.readFileSync(file, 'utf8'), stateJson([]));
});

test('restoreState refuses an artifact without a triage-state.json entry', async () => {
  const file = path.join(tmp(), 'triage-state.json');
  const { fetch } = fakeArtifacts(
    [{ id: 9, name: STATE_ARTIFACT_NAME, expired: false, created_at: '2026-09-26T07:00:00Z' }],
    { 9: zipOf({ 'other.json': '{}' }) },
  );
  await assert.rejects(restoreState({ api: new GitHubApi({ token: 't', fetch }), repo: 'o/r', file }), /triage-state\.json/);
  assert.equal(fs.existsSync(file), false);
});
