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

test('a control scoped within a dialog narrates normally and chains its selector', async ({
  page,
}) => {
  const demo = new DemoPage(page);

  await demo.openConfirm.click();
  await demo.confirmYes.expectVisible();
  await demo.confirmYes.click();

  const events = emittedEvents();
  expect(events.map((e) => e.sentence)).toEqual([
    'Click button "Confirm export"',
    'Assert button "Yes, export" is visible',
    'Click button "Yes, export"',
  ]);
  // The scoped control's StepEvent carries the full selector chain.
  expect(events[2].selector).toBe(
    '[data-testid="confirm-dialog"] [data-testid="confirm-yes"]',
  );
});

test('tooltip, editor and expectCount narrate their verbs', async ({ page }) => {
  const demo = new DemoPage(page);

  await demo.formatInfo.expectContent('3MF keeps colors and materials');
  await demo.description.write('Two-color keychain, PETG');
  await demo.description.expectText('Two-color keychain, PETG');
  await demo.description.clear();
  await demo.materialOption.expectCount(3);

  expect(emittedEvents().map((e) => e.sentence)).toEqual([
    'Assert tooltip "Format info" says "3MF keeps colors and materials"',
    'Type "Two-color keychain, PETG" into editor "Description"',
    'Assert editor "Description" has text "Two-color keychain, PETG"',
    'Clear editor "Description"',
    'Assert label "Material option" appears 3 times',
  ]);
});

test('failing tier-3 assertions report expected and actual', async ({ page }) => {
  const demo = new DemoPage(page);

  await expect(demo.materialOption.expectCount(5)).rejects.toThrow();
  await expect(demo.formatInfo.expectContent('wrong tip')).rejects.toThrow();

  const failed = emittedEvents().filter((e) => e.status === 'failed');
  expect(failed[0]).toMatchObject({
    action: 'assert-count',
    sentence: 'Assert label "Material option" appears 5 times',
    expected: '5',
    actual: '3',
  });
  expect(failed[1]).toMatchObject({
    action: 'assert-tooltip',
    expected: 'wrong tip',
    actual: '3MF keeps colors and materials',
  });
});
