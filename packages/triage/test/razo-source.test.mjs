import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RazoSource, razoSourcePlugin, readRuns, writeRun, toTestRun, errorSignature } from '../dist/index.js';
import { resultSourceContract, pluginContract, runContract, seed } from '../dist/contract.js';
import { writeSeedLayout } from './helpers/razo-layout.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'razo-source-'));

const manifest = {
  id: 'run-9', sha: 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2', branch: 'main',
  startedAt: '2026-09-24T06:00:00Z', finishedAt: '2026-09-24T06:04:00Z',
  ciUrl: 'https://github.com/razohq/razo-demo/actions/runs/1',
};

const step = (over) => ({
  action: 'click', controlType: 'button', name: 'Place order', sentence: 'Click button "Place order"',
  selector: '[data-testid="place-order"]', status: 'passed', timestamp: '2026-09-24T06:01:00Z', ...over,
});
const report = (over) => ({ test: 't', file: 'tests/a.spec.ts', status: 'passed', durationMs: 1, steps: [], ...over });
const stored = (retry, relPath, rep) => ({ retry, relPath, report: rep });

const NOT_FOUND = "locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByTestId('place-order')\n";

describe('layout', () => {
  test('writeRun then readRuns round-trips manifest, reports and retry numbers', () => {
    const dir = tmp();
    writeRun(dir, manifest, [
      { retry: 0, report: report({ status: 'failed', durationMs: 5, error: 'boom' }) },
      { retry: 1, report: report({ durationMs: 3 }) },
    ]);
    const [run] = readRuns(dir);
    assert.deepEqual(run.manifest, manifest);
    assert.deepEqual(run.reports.map((r) => r.retry).sort(), [0, 1]);
    assert.ok(run.reports.every((r) => r.relPath.startsWith('reports/') && r.relPath.endsWith('razo-steps.json')));
  });

  test('rejects a run directory without a valid run.json', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'runs', 'broken', 'reports'), { recursive: true });
    assert.throws(() => readRuns(dir), /broken/);
    fs.writeFileSync(path.join(dir, 'runs', 'broken', 'run.json'), '{"id":"broken"}');
    assert.throws(() => readRuns(dir), /broken.*"sha"/s);
  });

  test('an empty or missing dataDir yields no runs', () => {
    assert.deepEqual(readRuns(tmp()), []);
    assert.deepEqual(readRuns(path.join(tmp(), 'nope')), []);
  });

  test('the retry number comes from the report when it carries one, else from the directory name', () => {
    const dir = tmp();
    const runDir = path.join(dir, 'runs', 'r', 'reports');
    fs.mkdirSync(path.join(runDir, 'a-t-retry2'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'a-t-retry7'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', 'r', 'run.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(runDir, 'a-t-retry2', 'razo-steps.json'), JSON.stringify(report({})));
    fs.writeFileSync(path.join(runDir, 'a-t-retry7', 'razo-steps.json'), JSON.stringify(report({ retry: 1 })));
    const [run] = readRuns(dir);
    const byDir = Object.fromEntries(run.reports.map((r) => [path.basename(path.dirname(r.relPath)), r.retry]));
    assert.equal(byDir['a-t-retry2'], 2, 'from the directory name');
    assert.equal(byDir['a-t-retry7'], 1, 'the report field wins over the directory name');
  });

  test('a synthetic manifest round-trips its flag', () => {
    const dir = tmp();
    writeRun(dir, { ...manifest, synthetic: true }, [{ retry: 0, report: report({}) }]);
    assert.equal(readRuns(dir)[0].manifest.synthetic, true);
  });
});

describe('mapping', () => {
  test('testId is file::title, plus ::project when the report carries one', () => {
    const run = toTestRun(manifest, [
      stored(0, 'a', report({ test: 'pays' })),
      stored(0, 'b', report({ test: 'pays', project: 'firefox' })),
    ]);
    assert.deepEqual(run.results.map((r) => r.testId).sort(), ['tests/a.spec.ts::pays', 'tests/a.spec.ts::pays::firefox']);
    assert.equal(run.results.find((r) => r.project === 'firefox').testId, 'tests/a.spec.ts::pays::firefox');
    assert.equal(run.results.find((r) => !r.project).project, undefined, 'no project field when the report has none');
  });

  test('retries become ordered attempts and the final status is the highest retry', () => {
    const run = toTestRun(manifest, [
      stored(1, 'b', report({ durationMs: 3 })),
      stored(0, 'a', report({ status: 'failed', durationMs: 5, error: 'boom' })),
    ]);
    const [result] = run.results;
    assert.equal(result.status, 'passed');
    assert.equal(result.durationMs, 3);
    assert.deepEqual(result.attempts.map((a) => a.status), ['failed', 'passed']);
    assert.equal(result.attempts[0].error.message, 'boom');
    assert.equal(result.error, undefined);
  });

  test('attempts follow retry order even with gaps', () => {
    const run = toTestRun(manifest, [
      stored(2, 'c', report({ durationMs: 3 })),
      stored(0, 'a', report({ status: 'failed', durationMs: 5, error: 'boom' })),
    ]);
    assert.deepEqual(run.results[0].attempts.map((a) => a.status), ['failed', 'passed']);
    assert.equal(run.results[0].status, 'passed');
  });

  test('a failing report takes its error from the report, else from the last failed step', () => {
    const fromReport = toTestRun(manifest, [stored(0, 'a', report({
      status: 'failed', error: 'report-level', steps: [step({ status: 'failed', error: 'step-level' })],
    }))]);
    assert.equal(fromReport.results[0].error.message, 'report-level');
    const fromStep = toTestRun(manifest, [stored(0, 'a', report({
      status: 'failed', steps: [step({ status: 'failed', error: NOT_FOUND })],
    }))]);
    assert.equal(fromStep.results[0].error.message, NOT_FOUND);
    assert.equal(fromStep.results[0].error.signature, errorSignature(NOT_FOUND));
  });

  test('a failing report with no error text still yields a signed error', () => {
    const run = toTestRun(manifest, [stored(0, 'a', report({ status: 'timedOut', durationMs: 30000 }))]);
    assert.equal(run.results[0].error.message, 'timedOut without error message');
    assert.equal(run.results[0].error.signature, errorSignature('timedOut without error message'));
  });

  test('an unknown status string maps to failed rather than crashing', () => {
    const run = toTestRun(manifest, [stored(0, 'a', report({ status: 'exploded', error: 'x' }))]);
    assert.equal(run.results[0].status, 'failed');
  });

  test('controls, touchedComponents and healedLocators are derived from the steps of every attempt', () => {
    const run = toTestRun(manifest, [
      stored(0, 'a', report({ status: 'failed', error: 'x', steps: [
        step({ controlType: 'field', name: 'Email', selector: '[data-testid="email"]', sentence: 'Type "a" into field "Email"' }),
        step({ status: 'failed', error: 'x' }),
      ] })),
      stored(1, 'b', report({ steps: [
        step({ controlType: 'field', name: 'Email', selector: '[data-testid="email"]', sentence: 'Type "a" into field "Email"' }),
        step({ healed: { from: '[data-testid="place-order"]', to: 'role=button[name="Place order"]' }, selector: 'role=button[name="Place order"]' }),
      ] })),
    ]);
    const [result] = run.results;
    assert.deepEqual(result.touchedComponents, ['field "Email"', 'button "Place order"']);
    assert.deepEqual(result.controls, [
      { controlType: 'field', name: 'Email', selector: '[data-testid="email"]' },
      { controlType: 'button', name: 'Place order', selector: '[data-testid="place-order"]' },
      { controlType: 'button', name: 'Place order', selector: 'role=button[name="Place order"]' },
    ]);
    assert.deepEqual(result.healedLocators, [{ from: '[data-testid="place-order"]', to: 'role=button[name="Place order"]' }]);
  });

  test('a run without failures maps traceUrl to the ciUrl and keeps source razo-source', () => {
    const run = toTestRun(manifest, [stored(0, 'a', report({}))]);
    assert.equal(run.source, 'razo-source');
    assert.equal(run.results[0].traceUrl, manifest.ciUrl);
    assert.equal(run.results[0].touchedComponents, undefined);
    assert.equal(run.results[0].controls, undefined);
  });
});

describe('RazoSource passes the ResultSource contract', () => {
  runContract(resultSourceContract((runs) => {
    const dir = tmp();
    writeSeedLayout(dir, runs);
    return new RazoSource(dir);
  }), test);
});

describe('razoSourcePlugin', () => {
  runContract(pluginContract(razoSourcePlugin, { dataDir: tmp() }), test);
  test('rejects a config without dataDir', () => {
    assert.throws(() => razoSourcePlugin.configSchema.parse({}));
    assert.throws(() => razoSourcePlugin.configSchema.parse({ dataDir: '' }));
  });
  test('fetchRuns filters by finishedAt and returns runs ascending', async () => {
    const dir = tmp();
    writeSeedLayout(dir, structuredClone(seed.runs));
    const source = razoSourcePlugin.create({ dataDir: dir });
    const all = await source.fetchRuns(new Date(0));
    assert.deepEqual(all.map((r) => r.id), seed.runs.map((r) => r.id));
    const later = await source.fetchRuns(new Date(seed.runs[2].finishedAt));
    assert.deepEqual(later.map((r) => r.id), [seed.runs[2].id]);
  });
});

describe('review 5: malformed inputs name their file instead of crashing or vanishing', () => {
  test('run.json that is null or not an object is rejected naming the directory', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'runs', 'nully'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', 'nully', 'run.json'), 'null');
    assert.throws(() => readRuns(dir), /nully.*run\.json/);
  });
  test('a truncated razo-steps.json is rejected naming its path', () => {
    const dir = tmp();
    const rep = path.join(dir, 'runs', 'r', 'reports', 'a-t');
    fs.mkdirSync(rep, { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', 'r', 'run.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(rep, 'razo-steps.json'), '{"test": "t", "file": "a.spec.ts", "sta');
    assert.throws(() => readRuns(dir), /reports\/a-t\/razo-steps\.json/);
  });
  test('a report without steps maps with no controls instead of throwing', () => {
    const run = toTestRun(manifest, [stored(0, 'a', { test: 't', file: 'a.spec.ts', status: 'passed', durationMs: 1 })]);
    assert.equal(run.results[0].controls, undefined);
  });
  test('a manifest with an unparseable timestamp is rejected, never silently dropped by fetchRuns', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'runs', 'when', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', 'when', 'run.json'), JSON.stringify({ ...manifest, finishedAt: 'last night' }));
    await assert.rejects(new RazoSource(dir).fetchRuns(new Date(0)), /when.*finishedAt/);
  });
});
