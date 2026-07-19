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

test('universal interactions narrate with the grammar sentences', async ({ page }) => {
  const demo = new DemoPage(page);

  await demo.exportButton.hover();
  await demo.filename.focus();
  await demo.filename.press('Enter');
  await demo.exportButton.doubleClick();
  await demo.exportButton.rightClick();
  await demo.helpLink.scrollTo();
  await demo.modelFile.dragTo(demo.exportButton);

  expect(emittedEvents().map((e) => e.sentence)).toEqual([
    'Hover over button "Export"',
    'Focus field "Filename"',
    'Press "Enter" on field "Filename"',
    'Double-click button "Export"',
    'Right-click button "Export"',
    'Scroll to link "Help"',
    'Drag file input "Model file" onto button "Export"',
  ]);
});

test('universal assertions narrate expected state', async ({ page }) => {
  const demo = new DemoPage(page);

  await demo.helpSection.expectHidden();
  await demo.filename.focus();
  await demo.filename.expectFocused();
  await demo.filename.expectEmpty();
  await demo.helpLink.expectContainsText('Help');
  await demo.uploadButton.expectAttribute('disabled', '');

  expect(emittedEvents().map((e) => e.sentence)).toEqual([
    'Assert label "Help section" is hidden',
    'Focus field "Filename"',
    'Assert field "Filename" is focused',
    'Assert field "Filename" is empty',
    'Assert link "Help" contains text "Help"',
    'Assert button "Upload to cloud" attribute "disabled" is ""',
  ]);
});

test('a failing focus assertion reports expected and actual', async ({ page }) => {
  const demo = new DemoPage(page);

  await expect(demo.exportButton.expectFocused()).rejects.toThrow();

  const failed = emittedEvents().find((e) => e.status === 'failed')!;
  expect(failed).toMatchObject({
    action: 'assert-focused',
    sentence: 'Assert button "Export" is focused',
    expected: 'focused',
    actual: 'not focused',
    status: 'failed',
  });
});
