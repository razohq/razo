import { test, expect, type Page } from '@playwright/test';
import { Control, type ControlOptions } from '../src/controls/Control';
import { AI_STEP_ATTACHMENT, type StepEvent } from '../src/reporting/events';
import { DEMO_URL } from '../fixtures/demoUrl';

/** Minimal control to exercise the base class step() helper. */
class ProbeControl extends Control {
  protected readonly controlType = 'button';

  constructor(page: Page, testId: string, name: string, options?: ControlOptions) {
    super(page, testId, name, options);
  }

  async succeed() {
    return this.step('click', {}, async () => 'ok');
  }

  async fail() {
    return this.step('fill', { detail: 'abc' }, async () => {
      throw new Error('element not found');
    });
  }

  async businessOverride() {
    return this.step('click', { as: 'Confirm the export' }, async () => {});
  }
}

function emittedEvents(): StepEvent[] {
  return test
    .info()
    .attachments.filter((a) => a.name === AI_STEP_ATTACHMENT)
    .map((a) => JSON.parse(a.body!.toString()) as StepEvent);
}

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL);
});

test('a passing step emits a passed StepEvent with the grammar sentence', async ({ page }) => {
  const control = new ProbeControl(page, 'export', 'Export');
  await control.succeed();

  const [event] = emittedEvents();
  expect(event).toMatchObject({
    action: 'click',
    controlType: 'button',
    name: 'Export',
    sentence: 'Click button "Export"',
    selector: '[data-testid="export"]',
    status: 'passed',
  });
  expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('a failing step emits a failed StepEvent with the error and rethrows', async ({ page }) => {
  const control = new ProbeControl(page, 'export', 'Export');
  await expect(control.fail()).rejects.toThrow('element not found');

  const [event] = emittedEvents();
  expect(event).toMatchObject({
    action: 'fill',
    detail: 'abc',
    sentence: 'Type "abc" into button "Export"',
    status: 'failed',
    error: 'element not found',
  });
});

test('the sentence can be overridden for business-level narration', async ({ page }) => {
  const control = new ProbeControl(page, 'export', 'Export');
  await control.businessOverride();

  const [event] = emittedEvents();
  expect(event.sentence).toBe('Confirm the export');
  expect(event.action).toBe('click');
});

test('an anonymous control is rejected', async ({ page }) => {
  expect(() => new ProbeControl(page, 'export', '  ')).toThrow(/needs a human-readable name/);
});

test('a control within a parent appends the parent context to the sentence', async ({ page }) => {
  const parent = new ProbeControl(page, 'export', 'Export');
  const child = new ProbeControl(page, 'confirm', 'Confirm', { within: parent });
  await child.succeed(); // emits a 'click' step

  const [event] = emittedEvents();
  expect(event.sentence).toBe('Click button "Confirm" in button "Export"');
});

test('an explicit `as` overrides the auto within-context entirely', async ({ page }) => {
  const parent = new ProbeControl(page, 'export', 'Export');
  const child = new ProbeControl(page, 'confirm', 'Confirm', { within: parent });
  await child.businessOverride(); // step('click', { as: 'Confirm the export' })

  const [event] = emittedEvents();
  expect(event.sentence).toBe('Confirm the export');
});
