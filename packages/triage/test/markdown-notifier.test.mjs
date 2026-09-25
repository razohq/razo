import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MarkdownNotifier, markdownNotifierPlugin, renderMarkdown, readReports } from '../dist/index.js';
import { notifierContract, pluginContract, runContract, seed } from '../dist/contract.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'md-notifier-'));

describe('MarkdownNotifier passes the Notifier contract', () => {
  runContract(notifierContract(() => {
    const dir = tmp();
    return { notifier: new MarkdownNotifier(dir), received: () => readReports(dir) };
  }), test);
});

describe('markdownNotifierPlugin', () => {
  runContract(pluginContract(markdownNotifierPlugin, { outDir: tmp() }), test);
  test('rejects a config without outDir', () => assert.throws(() => markdownNotifierPlugin.configSchema.parse({})));
});

test('renderMarkdown shows totals, one section per cluster with verdict, tests, suspects, evidence and actions', () => {
  const md = renderMarkdown(seed.report);
  assert.match(md, /^# Triage /m);
  assert.match(md, /2 tests · 2 failures · 1 cluster/);
  assert.match(md, /## stale-test · medium/);
  assert.match(md, /placing the order confirms it/);
  assert.match(md, /Checkout: hide Place order/);
  assert.match(md, /- \[sha-range\]/);
  assert.match(md, /comment-issue/);
});

test('an empty report says there is nothing to triage', () => {
  const md = renderMarkdown({ ...seed.report, items: [], totals: { tests: 4, failures: 0, clusters: 0 } });
  assert.match(md, /No failures in this window/);
});

test('send writes a .md and a .json named by generatedAt, creating the directory', async () => {
  const dir = path.join(tmp(), 'nested', 'out');
  await new MarkdownNotifier(dir).send(seed.report);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['triage-2026-09-24T07-00-00.json', 'triage-2026-09-24T07-00-00.md']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')), seed.report);
});

test('two sends in the same second do not overwrite each other', async () => {
  const dir = tmp();
  const notifier = new MarkdownNotifier(dir);
  await notifier.send(seed.report);
  await notifier.send({ ...seed.report, generatedAt: '2026-09-24T07:00:00.500Z' });
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length, 2);
});

test('review 2b-7: readReports keeps send order across many sends in one second and across seconds', async () => {
  const dir = tmp();
  const notifier = new MarkdownNotifier(dir);
  for (let i = 0; i < 11; i++) await notifier.send({ ...seed.report, generatedAt: '2026-09-24T07:00:00Z', totals: { ...seed.report.totals, tests: i } });
  await notifier.send({ ...seed.report, generatedAt: '2026-09-24T07:00:01Z', totals: { ...seed.report.totals, tests: 11 } });
  assert.deepEqual(readReports(dir).map((r) => r.totals.tests), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});
