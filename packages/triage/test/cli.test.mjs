import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDuration, runTriage, parseConfig, readReports } from '../dist/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '../fixtures/razo-demo-pr-1');
const CLI = path.resolve(HERE, '../dist/cli.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'triage-cli-'));

test('parseDuration understands m/h/d and ISO dates', () => {
  const now = new Date('2026-09-25T07:00:00Z');
  assert.equal(parseDuration('24h', now).toISOString(), '2026-09-24T07:00:00.000Z');
  assert.equal(parseDuration('7d', now).toISOString(), '2026-09-18T07:00:00.000Z');
  assert.equal(parseDuration('30m', now).toISOString(), '2026-09-25T06:30:00.000Z');
  assert.equal(parseDuration('2026-09-01T00:00:00Z', now).toISOString(), '2026-09-01T00:00:00.000Z');
  assert.throws(() => parseDuration('soon', now), /soon/);
});

function demoConfig(outDir) {
  return parseConfig({
    source: { plugin: 'razo-source', config: { dataDir: DEMO } },
    code: { plugin: 'commits-json', config: { path: path.join(DEMO, 'commits.json') } },
    notifiers: [{ plugin: 'markdown', config: { outDir } }],
  }, {});
}

test('runTriage over the razo-demo fixture writes a report with the stale-test verdict', async () => {
  const outDir = tmp();
  const now = new Date('2026-08-04T07:00:00Z');
  const result = await runTriage(demoConfig(outDir), { now, since: parseDuration('2d', now), lookback: parseDuration('30d', now) });
  assert.equal(result.report.items.length, 2);
  const [report] = readReports(outDir);
  assert.equal(report.items.length, 2);
  assert.ok(report.items.some((i) => i.verdict.category === 'stale-test'));
  assert.equal(result.notified, 1);
  assert.equal(fs.readdirSync(outDir).filter((f) => f.endsWith('.md')).length, 1);
});

test('run with no failures writes an empty report', async () => {
  const outDir = tmp();
  const now = new Date('2026-08-03T03:30:00Z'); // after the green base run finished, before the PR run started
  const result = await runTriage(demoConfig(outDir), { now, since: parseDuration('1d', now), lookback: parseDuration('30d', now) });
  assert.deepEqual(result.report.items, []);
  assert.equal(result.report.totals.failures, 0);
  const md = fs.readFileSync(path.join(outDir, fs.readdirSync(outDir).find((f) => f.endsWith('.md'))), 'utf8');
  assert.match(md, /No failures in this window/);
});

test('the CLI runs end to end from a YAML config and prints the verdicts', () => {
  const dir = tmp();
  const outDir = path.join(dir, 'reports');
  fs.writeFileSync(path.join(dir, 'triage.config.yaml'), `
source:
  plugin: razo-source
  config: { dataDir: ${JSON.stringify(DEMO)} }
code:
  plugin: commits-json
  config: { path: ${JSON.stringify(path.join(DEMO, 'commits.json'))} }
notifiers:
  - plugin: markdown
    config: { outDir: ${JSON.stringify(outDir)} }
`);
  const out = execFileSync('node', [CLI, 'run', '--config', path.join(dir, 'triage.config.yaml'), '--since', '2d', '--lookback', '30d', '--now', '2026-08-04T07:00:00Z'], { encoding: 'utf8' });
  assert.match(out, /stale-test · medium · placing the order confirms it/);
  assert.match(out, /unknown · low · the cart lists both items/);
  assert.match(out, /1 notifier/);
  assert.equal(fs.readdirSync(outDir).length, 2);
});

test('the CLI rejects an unknown command and a bad duration with exit 2', () => {
  for (const args of [['frobnicate'], ['run', '--since', 'soon']]) {
    assert.throws(() => execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 2);
  }
});

test('pull without a pull section in the config fails with exit 2', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'triage.config.yaml'), `
source: { plugin: razo-source, config: { dataDir: ./.razo } }
code: { plugin: commits-json, config: { path: ./commits.json } }
`);
  assert.throws(() => execFileSync('node', [CLI, 'pull', '--config', path.join(dir, 'triage.config.yaml')], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 2 && /pull/.test(e.stderr));
});

test('hardening: an unknown flag is a usage error naming the flag', () => {
  assert.throws(
    () => execFileSync('node', [CLI, 'run', '--sinc', '24h'], { encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 2 && /--sinc/.test(e.stderr),
  );
});

test('hardening: totals.tests counts the tests of the window, not of the whole lookback', async () => {
  const dir = tmp();
  const { writeSeedLayout } = await import('./helpers/razo-layout.mjs');
  const run = (id, day, tests) => ({
    id, sha: String(day).repeat(40), branch: 'main', source: 's',
    startedAt: `2026-03-0${day}T00:00:00Z`, finishedAt: `2026-03-0${day}T00:05:00Z`,
    results: tests.map((t) => ({ testId: `f::${t}`, title: t, file: 'f.spec.ts', status: 'passed', durationMs: 1, attempts: [{ status: 'passed', durationMs: 1 }] })),
  });
  writeSeedLayout(dir, [run('old', 1, ['t1', 't2']), run('new', 5, ['t3'])]);
  const outDir = tmp();
  const cfg = parseConfig({
    source: { plugin: 'razo-source', config: { dataDir: dir } },
    code: { plugin: 'commits-json', config: { path: path.join(DEMO, 'commits.json') } },
    notifiers: [{ plugin: 'markdown', config: { outDir } }],
  }, {});
  const now = new Date('2026-03-06T00:00:00Z');
  const { report } = await runTriage(cfg, { now, since: parseDuration('2d', now), lookback: parseDuration('30d', now) });
  assert.equal(report.totals.tests, 1, 'only the run inside the window counts');
});

test('store: runTriage records the run and saves the clusters when a store is configured', async () => {
  const outDir = tmp();
  const stateFile = path.join(tmp(), 'triage-state.json');
  const cfg = parseConfig({
    source: { plugin: 'razo-source', config: { dataDir: DEMO } },
    code: { plugin: 'commits-json', config: { path: path.join(DEMO, 'commits.json') } },
    notifiers: [{ plugin: 'markdown', config: { outDir } }],
    store: { plugin: 'json-file', config: { path: stateFile } },
  }, {});
  const now = new Date('2026-08-04T07:00:00Z');
  const result = await runTriage(cfg, { now, since: parseDuration('2d', now), lookback: parseDuration('30d', now) });
  assert.equal(result.stored, true);
  const { JsonFileStore } = await import('../dist/index.js');
  const store = new JsonFileStore(stateFile);
  assert.equal((await store.lastTriageAt()).toISOString(), now.toISOString());
  const clusters = await store.loadClusters();
  assert.equal(clusters.length, 2);
  assert.ok(clusters.some((c) => c.category === 'stale-test'));
  const without = await runTriage(demoConfig(tmp()), { now, since: parseDuration('2d', now), lookback: parseDuration('30d', now) });
  assert.equal(without.stored, false);
});
