import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import { AI_STEP_ATTACHMENT, Input, MASKED, type StepEvent } from '../src';

function emittedEvents(): StepEvent[] {
  return test
    .info()
    .attachments.filter((a) => a.name === AI_STEP_ATTACHMENT)
    .map((a) => JSON.parse(a.body!.toString()) as StepEvent);
}

const SECRET = 'hunter2-hunter2';

test.beforeEach(async ({ page }) => {
  await page.setContent(`
    <input data-testid="password" type="password" aria-label="Password">
    <input data-testid="otp" autocomplete="one-time-code" aria-label="Code">
    <input data-testid="token" aria-label="API token">
    <input data-testid="email" type="email" aria-label="Email">
  `);
});

test('what is typed into a password field is masked in the sentence and the detail', async ({ page }) => {
  await new Input(page, 'password', 'Password').fill(SECRET);
  const [event] = emittedEvents();
  expect(event.sentence).toBe(`Type "${MASKED}" into field "Password"`);
  expect(event.detail).toBe(MASKED);
  expect(JSON.stringify(event)).not.toContain(SECRET);
  await expect(page.getByTestId('password')).toHaveValue(SECRET);
});

test('a one-time-code field is masked too', async ({ page }) => {
  await new Input(page, 'otp', 'Code').fill('493817');
  expect(emittedEvents()[0].sentence).toBe(`Type "${MASKED}" into field "Code"`);
});

test('an ordinary field keeps its value in the narration', async ({ page }) => {
  await new Input(page, 'email', 'Email').fill('ana@example.com');
  expect(emittedEvents()[0].sentence).toBe('Type "ana@example.com" into field "Email"');
});

test('sensitive: true masks a field the page does not mark, and false opts a password field out', async ({ page }) => {
  await new Input(page, 'token', 'API token').fill('sk-live-abc', { sensitive: true });
  await new Input(page, 'password', 'Password').fill('demo-password', { sensitive: false });
  const [token, password] = emittedEvents();
  expect(token.sentence).toBe(`Type "${MASKED}" into field "API token"`);
  expect(password.sentence).toBe('Type "demo-password" into field "Password"');
});

test('a failed assertion on a password field masks expected, actual and the error', async ({ page }) => {
  const field = new Input(page, 'password', 'Password');
  await field.fill('the-real-one');
  await expect(field.expectText(SECRET)).rejects.toThrow();
  const failed = emittedEvents().find((e) => e.status === 'failed')!;
  expect(failed.sentence).toBe(`Assert field "Password" has text "${MASKED}"`);
  expect(failed.expected).toBe(MASKED);
  expect(failed.actual).toBe(MASKED);
  for (const raw of [SECRET, 'the-real-one']) expect(JSON.stringify(failed)).not.toContain(raw);
});

test('sensitive: true masks even when the field is missing and the fill fails', async ({ page }) => {
  // No element and no same-name fallback: healing cannot find it, so the fill fails.
  await expect(new Input(page, 'gone', 'Recovery key').fill(SECRET, { sensitive: true })).rejects.toThrow();
  const failed = emittedEvents().find((e) => e.status === 'failed')!;
  expect(failed.sentence).toBe(`Type "${MASKED}" into field "Recovery key"`);
  expect(JSON.stringify(failed)).not.toContain(SECRET);
});

test('Playwright\'s own step under a masked fill does not carry the value either', async () => {
  test.setTimeout(60_000);
  const config = join(__dirname, 'fixtures/api-steps/playwright.config.ts');
  const { stdout } = await promisify(execFile)('npx', ['playwright', 'test', '-c', config], { cwd: join(__dirname, '..') });
  const { status, error, titles: all } = JSON.parse(stdout) as { status: string; error: string; titles: string[] };
  expect(status, error).toBe('passed');
  expect(all.some((t) => t.includes('hunter2-hunter2')), all.join('\n')).toBe(false);
  expect(all).toContain(`Type "${MASKED}" into field "Password"`);
  // An ordinary field keeps Playwright's fill, value and all.
  expect(all.some((t) => t.startsWith('Fill "ana@example.com"')), all.join('\n')).toBe(true);
});
