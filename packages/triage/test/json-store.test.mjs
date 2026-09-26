import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JsonFileStore, jsonFileStorePlugin, STATE_SCHEMA_VERSION } from '../dist/index.js';
import { storeContract, pluginContract, runContract, seed } from '../dist/contract.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'json-store-')), 'state', 'triage-state.json');

describe('JsonFileStore passes the TriageStore contract', () => {
  runContract(storeContract(() => new JsonFileStore(tmpFile())), test);
});

describe('jsonFileStorePlugin', () => {
  runContract(pluginContract(jsonFileStorePlugin, { path: tmpFile() }), test);
  test('rejects a config without path', () => assert.throws(() => jsonFileStorePlugin.configSchema.parse({})));
});

test('a missing file is an empty store; the first write creates the directory and the file with the schema version', async () => {
  const file = tmpFile();
  const store = new JsonFileStore(file);
  assert.equal(await store.lastTriageAt(), null);
  assert.deepEqual(await store.loadClusters(), []);
  assert.equal(fs.existsSync(file), false, 'reading never creates the file');
  await store.saveClusters([seed.report.items[0].cluster]);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.schemaVersion, STATE_SCHEMA_VERSION);
  assert.equal(raw.clusters.length, 1);
});

test('state survives a new instance over the same file', async () => {
  const file = tmpFile();
  await new JsonFileStore(file).recordRun({ id: 'r1', generatedAt: '2026-09-26T07:00:00Z', window: { from: 'a', to: 'b' }, totals: { tests: 1, failures: 0, clusters: 0 }, durationMs: 5 });
  const again = new JsonFileStore(file);
  assert.equal((await again.lastTriageAt()).toISOString(), '2026-09-26T07:00:00.000Z');
});

test('an unknown schema version is rejected naming the file and the version', async () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, clusters: [], runs: [], actions: [] }));
  await assert.rejects(new JsonFileStore(file).loadClusters(), (e) => /schema version 99/.test(e.message) && e.message.includes(file));
  fs.writeFileSync(file, '{"clusters": []}');
  await assert.rejects(new JsonFileStore(file).loadClusters(), /schema version/);
});

test('writes are atomic: no temporary file is left behind and a failing write keeps the previous state', async () => {
  const file = tmpFile();
  const store = new JsonFileStore(file);
  await store.saveClusters([seed.report.items[0].cluster]);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['triage-state.json']);
  // A cluster that cannot be serialized must not corrupt the file.
  const cyclic = { ...seed.report.items[0].cluster };
  cyclic.self = cyclic;
  await assert.rejects(store.saveClusters([cyclic]));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).clusters.length, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['triage-state.json']);
});
