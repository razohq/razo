import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test, expect, type Page } from '@playwright/test';
import { AI_SIGNAL_ATTACHMENT, Button, MAX_SIGNALS_PER_TEST, observePage, type PageSignal } from '../src';
import { attributeSignals } from '../src/reporting/signals';

function emittedSignals(): PageSignal[] {
  return test
    .info()
    .attachments.filter((a) => a.name === AI_SIGNAL_ATTACHMENT)
    .map((a) => JSON.parse(a.body!.toString()) as PageSignal);
}

/** A button whose click runs `script`, served from a fake origin so routes can answer for it. */
async function pageWith(page: Page, script: string) {
  await page.route('https://app.test/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<button data-testid="go" onclick="${script.replace(/"/g, '&quot;')}">Go</button>`,
  }));
  await page.goto('https://app.test/');
  return new Button(page, 'go', 'Go');
}

/** Signals arrive as page events; give the last one a moment to land. */
const settle = (page: Page) => page.waitForTimeout(200);

test('a console error during a step becomes a signal', async ({ page }) => {
  await (await pageWith(page, "console.error('cart total is NaN')")).click();
  await settle(page);
  const [signal] = emittedSignals();
  expect(signal).toMatchObject({ kind: 'console-error', text: 'cart total is NaN' });
  expect(Date.parse(signal.timestamp)).not.toBeNaN();
});

test('an uncaught exception in the page becomes a signal', async ({ page }) => {
  await (await pageWith(page, "setTimeout(() => { throw new Error('order is undefined') })")).click();
  await settle(page);
  expect(emittedSignals()).toEqual([expect.objectContaining({ kind: 'page-error', text: 'order is undefined' })]);
});

test('a 5xx answer becomes a signal with method, url and status; a 4xx does not', async ({ page }) => {
  await page.route('https://app.test/api/**', (route) =>
    route.fulfill({ status: route.request().url().endsWith('/orders') ? 503 : 404, body: '' }));
  await (await pageWith(page, "fetch('/api/orders', { method: 'POST' }); fetch('/api/missing')")).click();
  await settle(page);
  const signals = emittedSignals().filter((s) => s.kind !== 'console-error');
  expect(signals).toEqual([expect.objectContaining({
    kind: 'http-error', method: 'POST', url: 'https://app.test/api/orders', status: 503, text: 'POST https://app.test/api/orders → 503',
  })]);
});

test('a failed request becomes a signal, a cancelled one does not', async ({ page }) => {
  await page.route('https://app.test/api/**', (route) =>
    route.abort(route.request().url().endsWith('/down') ? 'connectionrefused' : 'aborted'));
  await (await pageWith(page, "fetch('/api/down').catch(() => {}); fetch('/api/cancelled').catch(() => {})")).click();
  await settle(page);
  const failed = emittedSignals().filter((s) => s.kind === 'request-failed');
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ method: 'GET', url: 'https://app.test/api/down' });
  expect(failed[0].text).toMatch(/^GET https:\/\/app\.test\/api\/down failed \(.+\)$/);
});

test('the browser\'s "Failed to load resource" echo of a request is not a second signal', async ({ page }) => {
  await page.route('https://app.test/broken.png', (route) => route.fulfill({ status: 500, body: '' }));
  await (await pageWith(page, "const i = new Image(); i.src = '/broken.png'; document.body.append(i)")).click();
  await settle(page);
  expect(emittedSignals().map((s) => s.kind)).toEqual(['http-error']);
});

test('listeners are attached once per page however many controls use it', async ({ page }) => {
  const go = await pageWith(page, "console.error('once')");
  await go.click();
  await new Button(page, 'go', 'Go again').click();
  await settle(page);
  expect(emittedSignals().filter((s) => s.text === 'once')).toHaveLength(2);
});

test('observePage catches what happens before the first control, such as the initial load', async ({ page }) => {
  observePage(page);
  await page.route('https://app.test/', (route) => route.fulfill({ contentType: 'text/html', body: "<script>console.error('boot failed')</script>" }));
  await page.goto('https://app.test/');
  await settle(page);
  expect(emittedSignals()).toEqual([expect.objectContaining({ kind: 'console-error', text: 'boot failed' })]);
});

test('a test keeps at most MAX_SIGNALS_PER_TEST signals, and long texts are cut', async ({ page }) => {
  await (await pageWith(page, `for (let i = 0; i < ${MAX_SIGNALS_PER_TEST + 10}; i++) console.error('e' + i + 'x'.repeat(600))`)).click();
  await settle(page);
  const signals = emittedSignals();
  expect(signals).toHaveLength(MAX_SIGNALS_PER_TEST);
  expect(signals[0].text.length).toBeLessThanOrEqual(501);
});

test('the reporter writes the signals, the step each one followed, and the first anomaly before the failure', async () => {
  test.setTimeout(60_000);
  const out = fs.mkdtempSync(join(os.tmpdir(), 'razo-signals-'));
  const config = join(__dirname, 'fixtures/signals/playwright.config.ts');
  await promisify(execFile)('npx', ['playwright', 'test', '-c', config], {
    cwd: join(__dirname, '..'), env: { ...process.env, RAZO_SIGNALS_OUT: out },
  }).catch(() => undefined); // the fixture fails on purpose
  const [dir] = fs.readdirSync(out).filter((d) => fs.existsSync(join(out, d, 'razo-steps.json')));
  const report = JSON.parse(fs.readFileSync(join(out, dir, 'razo-steps.json'), 'utf8'));
  expect(report.status).toBe('failed');
  // The click returns before the 500 arrives: every signal followed it, the assertion was still waiting.
  expect(report.signals.map((s: PageSignal) => [s.kind, s.afterStep])).toEqual([
    ['http-error', 'Click button "Place order"'],
    ['console-error', 'Click button "Place order"'],
    ['console-error', 'Click button "Place order"'],
  ]);
  expect(report.firstAnomaly).toMatchObject({ kind: 'http-error', status: 500, afterStep: 'Click button "Place order"' });
});

test('attributeSignals: a signal after the failure is not the first anomaly, one before any step follows none', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 16, 12, 0, s)).toISOString();
  const signal = (text: string, s: number): PageSignal => ({ kind: 'console-error', text, timestamp: at(s) });
  const steps = [
    { sentence: 'Click button "Pay"', status: 'passed', timestamp: at(2) },
    { sentence: 'Assert label "Status" has text "Paid"', status: 'failed', timestamp: at(5) },
  ];
  const { signals, firstAnomaly } = attributeSignals([signal('teardown', 8), signal('boot', 1)], steps);
  expect(signals.map((s) => [s.text, s.afterStep])).toEqual([['boot', undefined], ['teardown', 'Assert label "Status" has text "Paid"']]);
  expect(firstAnomaly?.text).toBe('boot');
  expect(attributeSignals([signal('teardown', 8)], steps).firstAnomaly).toBeUndefined();
  expect(attributeSignals([signal('late', 8)], [steps[0]]).firstAnomaly?.text, 'no failed step: the whole test counts').toBe('late');
});
