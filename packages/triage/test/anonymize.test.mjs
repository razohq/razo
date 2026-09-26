import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anonymizeReport } from '../scripts/anonymize-fixture.mjs';

const report = {
  test: 'placing the order confirms it', file: 'tests/checkout.spec.ts', status: 'failed', durationMs: 5,
  error: "locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByTestId('place-order')\n  at /Users/ana/proj/tests/checkout.spec.ts:12",
  steps: [{
    action: 'click', controlType: 'button', name: 'Place order', sentence: 'Click button "Place order"',
    selector: '[data-testid="place-order"]', status: 'failed', error: 'x', timestamp: '2026-09-24T06:01:00Z',
    domCandidates: ['role=button name="Place order"'],
    healed: { from: '[data-testid="place-order"]', to: 'role=button[name="Place order"]' },
  }],
};

test('is deterministic for the same salt and different across salts', () => {
  const a = anonymizeReport(structuredClone(report), new Map(), 's1');
  const b = anonymizeReport(structuredClone(report), new Map(), 's1');
  const c = anonymizeReport(structuredClone(report), new Map(), 's2');
  assert.deepEqual(a, b);
  assert.notEqual(a.test, c.test);
});

test('replaces titles, control names, testids and file names consistently and strips absolute paths', () => {
  const out = anonymizeReport(structuredClone(report), new Map(), 'salt');
  assert.notEqual(out.test, report.test);
  assert.equal(out.test.split(' ').length, report.test.split(' ').length, 'word count preserved');
  assert.notEqual(out.steps[0].name, 'Place order');
  assert.equal(out.steps[0].sentence, `Click button "${out.steps[0].name}"`);
  assert.match(out.steps[0].selector, /^\[data-testid="[a-z]+-[a-z]+"\]$/);
  assert.equal(out.steps[0].healed.from, out.steps[0].selector, 'the same testid maps to the same token everywhere');
  assert.match(out.file, /^tests\/[a-z]+-[a-z]+\.spec\.ts$/);
  assert.doesNotMatch(out.error, /\/Users\//);
  assert.doesNotMatch(JSON.stringify(out), /Place order|place-order|checkout/);
});

test('keeps the error skeleton so signatures stay comparable', () => {
  const out = anonymizeReport(structuredClone(report), new Map(), 'salt');
  assert.match(out.error, /^locator\.click: Timeout 5000ms exceeded\./);
  assert.match(out.error, /waiting for getByTestId\('[a-z]+-[a-z]+'\)/);
});

test('a shared dictionary keeps names stable across reports', () => {
  const dictionary = new Map();
  const a = anonymizeReport(structuredClone(report), dictionary, 'salt');
  const b = anonymizeReport(structuredClone({ ...report, test: 'another test' }), dictionary, 'salt');
  assert.equal(a.steps[0].name, b.steps[0].name);
  assert.equal(a.file, b.file);
});
