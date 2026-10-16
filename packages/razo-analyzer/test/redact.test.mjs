import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildUploadPayload, createRedactor, redactReport, REDACTED } from '../dist/index.js';

const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const ANTHROPIC = 'sk-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz012345';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const ENV_SECRET = 'staging-db-pw-7f3a9c';

const step = (over) => ({
  action: 'click', controlType: 'button', name: 'Save', sentence: 'Click button "Save"',
  selector: '[data-testid="save"]', status: 'passed', timestamp: '2026-10-16T00:00:00.000Z', ...over,
});

const report = () => ({
  test: 'logs in and saves', file: 'tests/secrets.spec.ts', status: 'failed', durationMs: 1200,
  error: `Error: request failed with Authorization: Bearer ${GH}`,
  steps: [
    step({ action: 'fill', controlType: 'field', name: 'Password', detail: 'hunter2-hunter2', sentence: 'Type "hunter2-hunter2" into field "Password"', selector: '[data-testid="password"]' }),
    step({ action: 'fill', controlType: 'field', name: 'Email', detail: 'ana@example.com', sentence: 'Type "ana@example.com" into field "Email"', selector: '[data-testid="email"]' }),
    step({
      action: 'assert-text', controlType: 'label', name: 'Status', sentence: 'Assert label "Status" has text "Saved"',
      expected: 'Saved', actual: `Unauthorized: token=${ANTHROPIC}`, status: 'failed',
      error: `expect(locator).toHaveText(expected) failed\nGET https://admin:${ENV_SECRET}@api.example.com/v1?access_token=${JWT}\n  at tests/secrets.spec.ts:14:61`,
    }),
  ],
});

const env = { DB_PASSWORD: ENV_SECRET, HOME: '/home/runner', CI: 'true' };

test('known token shapes are masked wherever they appear', () => {
  const r = redactReport(report(), createRedactor(env));
  const all = JSON.stringify(r);
  for (const secret of [GH, ANTHROPIC, JWT]) assert.ok(!all.includes(secret), secret.slice(0, 8));
  assert.match(r.error, /Authorization: \[REDACTED\]$/, 'the header value goes, scheme included');
});

test('values of sensitive environment variables are masked, other variables are not', () => {
  const r = redactReport(report(), createRedactor(env));
  assert.ok(!JSON.stringify(r).includes(ENV_SECRET));
  assert.ok(!createRedactor(env).string('cwd /home/runner').includes(REDACTED), 'HOME is not a secret');
});

test('what a test types into a sensitive field is masked in the detail and the sentence', () => {
  const [password, email] = redactReport(report(), createRedactor({})).steps;
  assert.equal(password.detail, REDACTED);
  assert.equal(password.sentence, `Type "${REDACTED}" into field "Password"`);
  assert.equal(email.detail, 'ana@example.com', 'an ordinary field keeps its value');
  assert.equal(email.sentence, 'Type "ana@example.com" into field "Email"');
});

test('the rest of the report is untouched: narration, file locations, structure', () => {
  const original = report();
  const r = redactReport(original, createRedactor({}));
  assert.match(r.steps[2].error, /at tests\/secrets\.spec\.ts:14:61/);
  assert.equal(r.steps[2].sentence, original.steps[2].sentence);
  assert.equal(r.steps[2].expected, 'Saved');
  assert.deepEqual(Object.keys(r), Object.keys(original));
  assert.equal(original.steps[0].detail, 'hunter2-hunter2', 'the input report is not mutated');
});

test('the prompt sent to the model carries no secret', () => {
  const prompt = buildPrompt([report()], createRedactor(env));
  for (const secret of [GH, ANTHROPIC, JWT, ENV_SECRET, 'hunter2-hunter2']) assert.ok(!prompt.includes(secret), secret.slice(0, 8));
  assert.match(prompt, /Type "\[REDACTED\]" into field "Password"/);
});

test('the upload payload carries no secret', () => {
  const payload = buildUploadPayload([report()], { ...env, GITHUB_REF_NAME: 'main' });
  const body = JSON.stringify(payload);
  for (const secret of [GH, ANTHROPIC, JWT, ENV_SECRET, 'hunter2-hunter2']) assert.ok(!body.includes(secret), secret.slice(0, 8));
  assert.equal(payload.run.branch, 'main');
});

test('page signals are redacted too: a token in a request URL, a JWT in a console error', () => {
  const r = redactReport({
    ...report(),
    signals: [
      { kind: 'http-error', method: 'GET', url: `https://api.example.com/v1?access_token=${JWT}`, status: 500, text: `GET https://api.example.com/v1?access_token=${JWT} → 500`, timestamp: '2026-10-16T00:00:01.000Z' },
      { kind: 'console-error', text: `auth failed for ${GH}`, timestamp: '2026-10-16T00:00:02.000Z' },
    ],
    firstAnomaly: { kind: 'console-error', text: `auth failed for ${GH}`, timestamp: '2026-10-16T00:00:02.000Z' },
  }, createRedactor(env));
  const all = JSON.stringify(r);
  for (const secret of [JWT, GH]) assert.ok(!all.includes(secret), secret.slice(0, 8));
  assert.equal(r.signals[0].status, 500, 'the rest of the signal is kept');
});
