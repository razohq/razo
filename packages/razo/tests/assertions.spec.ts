import { test, expect } from '@playwright/test';
import { DemoPage } from '../pages/DemoPage';
import { AI_STEP_ATTACHMENT, type StepEvent } from '../src';

function emittedEvents(): StepEvent[] {
  return test
    .info()
    .attachments.filter((a) => a.name === AI_STEP_ATTACHMENT)
    .map((a) => JSON.parse(a.body!.toString()) as StepEvent);
}

test.beforeEach(async ({ page }) => {
  await new DemoPage(page).goto();
});

test('assertions narrate what was expected', async ({ page }) => {
  const demo = new DemoPage(page);

  await demo.exportButton.expectVisible();
  await demo.exportButton.expectEnabled();
  await demo.uploadButton.expectDisabled();
  await demo.includeSupports.check();
  await demo.includeSupports.expectChecked();
  await demo.quality.select('Fine');
  await demo.quality.expectSelected('Fine');
  await demo.filename.fill('llavero');
  await demo.filename.expectText('llavero');

  const events = emittedEvents();
  expect(events.map((e) => e.sentence)).toEqual([
    'Assert button "Export" is visible',
    'Assert button "Export" is enabled',
    'Assert button "Upload to cloud" is disabled',
    'Check checkbox "Include supports"',
    'Assert checkbox "Include supports" is checked',
    'Select option "Fine" in radio group "Quality"',
    'Assert radio group "Quality" has option "Fine" selected',
    'Type "llavero" into field "Filename"',
    'Assert field "Filename" has text "llavero"',
  ]);

  const assertion = events.find((e) => e.action === 'assert-selected')!;
  expect(assertion.expected).toBe('Fine');
  expect(assertion.status).toBe('passed');
});

test('a failing assertion emits expected and actual', async ({ page }) => {
  const demo = new DemoPage(page);

  await demo.filename.fill('llavero');
  await demo.format.choose('3MF');
  await demo.quality.select('Draft');
  await demo.exportButton.click();

  await expect(demo.status.expectText('Exported llavero.3mf (Fine)')).rejects.toThrow();

  const failed = emittedEvents().find((e) => e.status === 'failed')!;
  expect(failed).toMatchObject({
    action: 'assert-text',
    sentence: 'Assert label "Export status" has text "Exported llavero.3mf (Fine)"',
    expected: 'Exported llavero.3mf (Fine)',
    actual: 'Exported llavero.3mf (Draft)',
    status: 'failed',
  });
  expect(failed.error).toContain('toHaveText');
});
