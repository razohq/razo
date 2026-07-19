import { test, expect } from '@playwright/test';
import { Button } from '../src/controls/Button';
import { Dialog } from '../src/controls/Dialog';
import { AI_STEP_ATTACHMENT, type StepEvent } from '../src/reporting/events';
import { DEMO_URL } from '../fixtures/demoUrl';

function emittedEvents(): StepEvent[] {
  return test
    .info()
    .attachments.filter((a) => a.name === AI_STEP_ATTACHMENT)
    .map((a) => JSON.parse(a.body!.toString()) as StepEvent);
}

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL);
});

test.afterEach(() => {
  delete process.env.RAZO_HEALING;
});

test('a stale testid heals through the implicit role fallback', async ({ page }) => {
  const button = new Button(page, 'healing-export-v1', 'Healed export');
  await button.click();

  const [event] = emittedEvents();
  expect(event.status).toBe('passed');
  expect(event.sentence).toBe('Click button "Healed export"');
  expect(event.healed).toEqual({
    from: '[data-testid="healing-export-v1"]',
    to: 'role=button[name="Healed export"]',
  });
  expect(event.selector).toBe('role=button[name="Healed export"]');
});

test('explicit fallbacks win over the implicit role fallback', async ({ page }) => {
  const button = new Button(page, 'healing-export-v1', 'Healed export', {
    fallbacks: [{ text: 'Healed export' }],
  });
  await button.click();

  const [event] = emittedEvents();
  expect(event.status).toBe('passed');
  expect(event.healed?.to).toBe('text="Healed export"');
});

test('RAZO_HEALING=fail turns a healed locator into a drift failure', async ({ page }) => {
  process.env.RAZO_HEALING = 'fail';
  const button = new Button(page, 'healing-export-v1', 'Healed export');
  await expect(button.click()).rejects.toThrow(/locator drift/);

  const [event] = emittedEvents();
  expect(event.status).toBe('failed');
  expect(event.healed).toEqual({
    from: '[data-testid="healing-export-v1"]',
    to: 'role=button[name="Healed export"]',
  });
  expect(event.error).toContain('locator drift');
});

test('RAZO_HEALING=off fails without healing or candidates', async ({ page }) => {
  process.env.RAZO_HEALING = 'off';
  const button = new Button(page, 'healing-export-v1', 'Healed export');
  await expect(button.click()).rejects.toThrow();

  const [event] = emittedEvents();
  expect(event.status).toBe('failed');
  expect(event.healed).toBeUndefined();
  expect(event.domCandidates).toBeUndefined();
});

test('an element nothing can heal reports DOM candidates for the analyzer', async ({ page }) => {
  const button = new Button(page, 'gone-forever', 'No Such Button Anywhere');
  await expect(button.click()).rejects.toThrow();

  const [event] = emittedEvents();
  expect(event.status).toBe('failed');
  expect(event.healed).toBeUndefined();
  expect(event.domCandidates!.length).toBeGreaterThan(0);
  expect(event.domCandidates!.join(' ')).toContain('role=button');
});

test('a failing assertion on a present element never triggers healing', async ({ page }) => {
  const button = new Button(page, 'export', 'Export');
  await expect(button.expectDisabled()).rejects.toThrow();

  const [event] = emittedEvents();
  expect(event.status).toBe('failed');
  expect(event.healed).toBeUndefined();
  expect(event.domCandidates).toBeUndefined();
});

test('a scoped control heals inside its within parent and keeps the chained selector', async ({ page }) => {
  // Open the confirm dialog through healthy controls first.
  const open = new Button(page, 'open-confirm', 'Confirm export');
  await open.click();

  const dialog = new Dialog(page, 'confirm-dialog', 'Confirm export');
  const yes = new Button(page, 'confirm-yes-v1', 'Yes, export', { within: dialog });
  await yes.click();

  const events = emittedEvents();
  const healedEvent = events.find((e) => e.healed);
  expect(healedEvent?.status).toBe('passed');
  expect(healedEvent?.healed).toEqual({
    from: '[data-testid="confirm-dialog"] [data-testid="confirm-yes-v1"]',
    to: '[data-testid="confirm-dialog"] role=button[name="Yes, export"]',
  });
});
