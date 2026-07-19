import { test, expect } from '@playwright/test';
import { Button, Dialog, Image, Input, Label, AI_STEP_ATTACHMENT, type StepEvent } from '../src';
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

test('every locator strategy narrates identically and describes its selector', async ({
  page,
}) => {
  const byRole = new Button(page, { role: 'button', name: 'Export', exact: true }, 'Export');
  const byLabel = new Input(page, { label: 'Filename' }, 'Filename');
  const byText = new Button(page, { text: 'Upload to cloud' }, 'Upload to cloud');
  const byCss = new Label(page, { css: '#status' }, 'Export status');
  const byAlt = new Image(page, { altText: 'Model preview' }, 'Model preview');
  const byRaw = new Button(page, { locator: page.getByTestId('export') }, 'Export');

  await byLabel.fill('llavero');
  await byRole.click();
  await byText.expectDisabled();
  await byCss.expectContainsText('Error');
  await byAlt.expectLoaded();
  await byRaw.expectEnabled();

  const events = emittedEvents();
  // The narration does not depend on the locator strategy.
  expect(events.map((e) => e.sentence)).toEqual([
    'Type "llavero" into field "Filename"',
    'Click button "Export"',
    'Assert button "Upload to cloud" is disabled',
    'Assert label "Export status" contains text "Error"',
    'Assert image "Model preview" is loaded',
    'Assert button "Export" is enabled',
  ]);
  // The selector does, and stays readable per strategy.
  expect(events.map((e) => e.selector)).toEqual([
    'label="Filename"',
    'role=button[name="Export"]',
    'text="Upload to cloud"',
    'css=#status',
    'alt="Model preview"',
    "getByTestId('export')",
  ]);
});

test('a role-located control composes with within', async ({ page }) => {
  const openConfirm = new Button(page, 'open-confirm', 'Confirm export');
  const dialog = new Dialog(page, 'confirm-dialog', 'Confirm export');
  const yes = new Button(page, { role: 'button', name: 'Yes, export' }, 'Yes, export', {
    within: dialog,
  });

  await openConfirm.click();
  await yes.click();

  const events = emittedEvents();
  expect(events[1].sentence).toBe('Click button "Yes, export"');
  expect(events[1].selector).toBe(
    '[data-testid="confirm-dialog"] role=button[name="Yes, export"]',
  );
});

test('a failing assertion on a non-testid control keeps the readable selector', async ({
  page,
}) => {
  const status = new Label(page, { css: '#status' }, 'Export status');

  await expect(status.expectText('Exported')).rejects.toThrow();

  const failed = emittedEvents().find((e) => e.status === 'failed')!;
  expect(failed).toMatchObject({
    sentence: 'Assert label "Export status" has text "Exported"',
    selector: 'css=#status',
    expected: 'Exported',
    status: 'failed',
  });
});
