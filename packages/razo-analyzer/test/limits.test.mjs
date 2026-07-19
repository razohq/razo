import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ERROR_CHARS,
  MAX_PAYLOAD_BYTES,
  MAX_STEPS_PER_REPORT,
  prepareUploadReports,
  truncateReport,
} from '../dist/index.js';

function step(status = 'passed', extra = {}) {
  return {
    action: 'click', controlType: 'button', name: 'Export',
    sentence: 'Click button "Export"', selector: '[data-testid="export"]',
    status, timestamp: '2026-07-14T00:00:00.000Z', ...extra,
  };
}

function report(overrides = {}) {
  return {
    test: 'demo test', file: 'demo.spec.ts', status: 'failed',
    durationMs: 1000, error: 'boom', steps: [step('failed', { error: 'boom' })],
    ...overrides,
  };
}

test('a giant error is truncated with a marker, keeping the beginning', () => {
  const huge = 'Expected: A\nReceived: B\n' + 'x'.repeat(100_000);
  const { report: out, trimmed } = truncateReport(report({ error: huge }));
  assert.equal(trimmed, true);
  assert.ok(out.error.length <= MAX_ERROR_CHARS);
  assert.ok(out.error.startsWith('Expected: A'));
  assert.ok(out.error.endsWith('… [truncated]'));
});

test('step-level long fields are truncated too', () => {
  const { report: out } = truncateReport(report({
    steps: [step('failed', { error: 'e'.repeat(50_000), actual: 'a'.repeat(10_000) })],
  }));
  assert.ok(out.steps[0].error.length <= MAX_ERROR_CHARS);
  assert.ok(out.steps[0].actual.length <= 2048);
});

test('1500 steps collapse to the cap, keeping every failed step and an omission marker', () => {
  const steps = Array.from({ length: 1500 }, (_, i) =>
    step(i === 10 || i === 700 || i === 1400 ? 'failed' : 'passed', { name: `s${i}` }));
  const { report: out, trimmed } = truncateReport(report({ steps }));
  assert.equal(trimmed, true);
  assert.ok(out.steps.length <= MAX_STEPS_PER_REPORT);
  const failedNames = out.steps.filter((s) => s.status === 'failed').map((s) => s.name);
  assert.deepEqual(failedNames, ['s10', 's700', 's1400']);
  const marker = out.steps.find((s) => s.action === 'omitted');
  assert.match(marker.sentence, /\d+ steps omitted by razo-upload/);
});

test('a normal report passes through byte-identical', () => {
  const original = report();
  const { report: out, trimmed } = truncateReport(original);
  assert.equal(trimmed, false);
  assert.equal(JSON.stringify(out), JSON.stringify(original));
});

test('an oversized payload drops the heaviest passed reports and keeps every failed one', () => {
  const fat = 'z'.repeat(120_000);
  const reports = [
    ...Array.from({ length: 20 }, (_, i) =>
      report({ test: `passed ${i}`, status: 'passed', error: undefined, steps: [step('passed', { detail: fat.slice(0, 2000) })], file: fat.slice(0, 500) })),
    ...Array.from({ length: 30 }, (_, i) =>
      report({ test: `heavy passed ${i}`, status: 'passed', error: undefined, steps: Array.from({ length: 60 }, () => step('passed', { detail: 'd'.repeat(1500) })) })),
    report({ test: 'the failure' }),
  ];
  const { reports: out, droppedPassed } = prepareUploadReports(reports);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= MAX_PAYLOAD_BYTES - 1000);
  assert.ok(droppedPassed > 0);
  assert.ok(out.some((r) => r.test === 'the failure'));
});

test('prepareUploadReports is a no-op for small suites', () => {
  const reports = [report(), report({ test: 'two', status: 'passed', error: undefined })];
  const { reports: out, droppedPassed, trimmedReports } = prepareUploadReports(reports);
  assert.equal(droppedPassed, 0);
  assert.equal(trimmedReports, 0);
  assert.equal(JSON.stringify(out), JSON.stringify(reports));
});
