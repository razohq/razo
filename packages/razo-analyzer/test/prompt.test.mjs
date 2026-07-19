import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, loadFailedReports } from '../dist/index.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const failedReport = {
  test: 'export a model without choosing quality',
  file: 'tests/demo.spec.ts',
  status: 'failed',
  durationMs: 3200,
  error: 'Error: expect(locator).toHaveText(expected) failed',
  steps: [
    {
      action: 'fill',
      controlType: 'field',
      name: 'Filename',
      sentence: 'Type "mi-llavero" into field "Filename"',
      detail: 'mi-llavero',
      selector: '[data-testid="filename"]',
      status: 'passed',
      timestamp: '2026-07-10T00:00:00.000Z',
    },
    {
      action: 'assert-text',
      controlType: 'label',
      name: 'Export status',
      sentence: 'Assert label "Export status" has text "Exported mi-llavero.3mf (Standard)"',
      expected: 'Exported mi-llavero.3mf (Standard)',
      actual: 'Error: missing fields',
      selector: '[data-testid="status"]',
      status: 'failed',
      error: 'expect(locator).toHaveText(expected) failed\nLocator: getByTestId(status)',
      timestamp: '2026-07-10T00:00:03.000Z',
    },
  ],
};

test('buildPrompt narrates every step with status, expected and actual', () => {
  const prompt = buildPrompt([failedReport]);
  assert.match(prompt, /Test: export a model without choosing quality/);
  assert.match(prompt, /\[passed\] Type "mi-llavero" into field "Filename"/);
  assert.match(prompt, /\[failed\] Assert label "Export status"/);
  assert.match(prompt, /expected: "Exported mi-llavero\.3mf \(Standard\)"/);
  assert.match(prompt, /actual: {3}"Error: missing fields"/);
  // only the first line of the raw error — the narration carries the signal
  assert.match(prompt, /error: expect\(locator\)\.toHaveText\(expected\) failed/);
  assert.doesNotMatch(prompt, /Locator: getByTestId/);
});

test('loadFailedReports picks only non-passed reports from a tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'razo-analyzer-'));
  const write = (name, report) => {
    const sub = path.join(dir, name);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'razo-steps.json'), JSON.stringify(report));
  };
  write('a-passed', { ...failedReport, test: 'ok', status: 'passed' });
  write('b-failed', failedReport);
  write('c-skipped', { ...failedReport, test: 'skipped', status: 'skipped' });

  const failed = loadFailedReports(dir);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].test, 'export a model without choosing quality');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildPrompt surfaces healed steps and DOM candidates', () => {
  const report = {
    ...failedReport,
    steps: [
      {
        ...failedReport.steps[0],
        healed: { from: '[data-testid="filename-v1"]', to: 'role=textbox[name="Filename"]' },
      },
      {
        ...failedReport.steps[1],
        domCandidates: ['role=button name="Export CSV"', 'role=button name="Export PDF"'],
      },
    ],
  };
  const prompt = buildPrompt([report]);
  assert.match(prompt, /healed: primary \[data-testid="filename-v1"\] no longer resolves; found via role=textbox\[name="Filename"\]/);
  assert.match(prompt, /DOM candidates: role=button name="Export CSV" \| role=button name="Export PDF"/);
});

test('buildPrompt omits healing lines when the fields are absent', () => {
  const prompt = buildPrompt([failedReport]);
  assert.ok(!prompt.includes('healed:'));
  assert.ok(!prompt.includes('DOM candidates:'));
});

// --- prompt budget & batching ---

const { batchReports, trimReportForPrompt, renderReport } = await import('../dist/index.js');

function bulkyReport(name, stepCount, failedAt = []) {
  return {
    ...failedReport,
    test: name,
    steps: Array.from({ length: stepCount }, (_, i) => ({
      ...failedReport.steps[0],
      name: `step ${i}`,
      status: failedAt.includes(i) ? 'failed' : 'passed',
    })),
  };
}

test('small suites fit one batch', () => {
  const batches = batchReports([failedReport, bulkyReport('b', 20, [5])], 200_000);
  assert.equal(batches.length, 1);
});

test('many medium reports split into batches under the budget', () => {
  const reports = Array.from({ length: 30 }, (_, i) => bulkyReport(`t${i}`, 200, [10]));
  const budget = 60_000;
  const batches = batchReports(reports, budget);
  assert.ok(batches.length > 1);
  for (const batch of batches) {
    assert.ok(batch.map(renderReport).join('\n').length <= budget);
  }
  assert.equal(batches.flat().length, 30);
});

test('a report exceeding the whole budget gets its own trimmed batch', () => {
  const giant = bulkyReport('giant', 5_000, [100, 4_000]);
  const batches = batchReports([giant, failedReport], 30_000);
  const giantBatch = batches.find((b) => b.some((r) => r.test === 'giant'));
  assert.equal(giantBatch.length, 1);
  assert.ok(renderReport(giantBatch[0]).length <= 30_000);
});

test('trimReportForPrompt keeps every failed step and marks the omission', () => {
  const giant = bulkyReport('giant', 5_000, [100, 4_000]);
  const trimmed = trimReportForPrompt(giant, 20_000);
  assert.ok(renderReport(trimmed).length <= 20_000);
  const failedNames = trimmed.steps.filter((s) => s.status === 'failed').map((s) => s.name);
  assert.deepEqual(failedNames, ['step 100', 'step 4000']);
  assert.ok(trimmed.steps.some((s) => s.action === 'omitted'));
});

test('analyzeFailures makes one API call per batch and concatenates in order', async () => {
  const { analyzeFailures } = await import('../dist/index.js');
  const calls = [];
  const fakeClient = {
    messages: {
      create: async (params) => {
        calls.push(params.messages[0].content);
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: `analysis ${calls.length}` }] };
      },
    },
  };
  const reports = Array.from({ length: 10 }, (_, i) => bulkyReport(`t${i}`, 200, [10]));
  const result = await analyzeFailures(reports, { client: fakeClient, budgetChars: 40_000 });
  assert.ok(calls.length > 1);
  assert.match(result, /analysis 1[\s\S]*analysis 2/);
});
