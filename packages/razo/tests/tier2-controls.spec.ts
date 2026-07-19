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

test('switch, combobox, table, image, date picker and menu narrate their verbs', async ({
  page,
}) => {
  const demo = new DemoPage(page);

  await demo.autoSave.turnOn();
  await demo.autoSave.expectOn();
  await demo.autoSave.turnOff();
  await demo.autoSave.expectOff();

  await demo.material.search('PE');
  await demo.material.pick('PETG');
  await demo.material.expectSelected('PETG');

  await demo.exportHistory.expectRowCount(2);
  await demo.exportHistory.expectRowContains('mi-llavero');

  await demo.preview.expectAlt('Model preview');
  await demo.preview.expectLoaded();

  await demo.deadline.pick('2026-08-01');
  await demo.deadline.expectDate('2026-08-01');

  await demo.actionsMenu.choose('Archive');
  await demo.menuStatus.expectText('Action: Archive');

  expect(emittedEvents().map((e) => e.sentence)).toEqual([
    'Turn on switch "Auto-save"',
    'Assert switch "Auto-save" is on',
    'Turn off switch "Auto-save"',
    'Assert switch "Auto-save" is off',
    'Type "PE" into combobox "Material"',
    'Pick "PETG" in combobox "Material"',
    'Assert combobox "Material" has value "PETG"',
    'Assert table "Export history" has 2 rows',
    'Assert table "Export history" has a row containing "mi-llavero"',
    'Assert image "Model preview" has alt text "Model preview"',
    'Assert image "Model preview" is loaded',
    'Pick date "2026-08-01" in date picker "Deadline"',
    'Assert date picker "Deadline" has value "2026-08-01"',
    'Choose "Archive" in menu "Actions"',
    'Assert label "Menu status" has text "Action: Archive"',
  ]);
});

test('dialog and tabs narrate open, close and active state', async ({ page }) => {
  const demo = new DemoPage(page);

  await demo.confirmDialog.expectClosed();
  await demo.openConfirm.click();
  await demo.confirmDialog.expectOpen();
  await demo.confirmDialog.close();
  await demo.confirmDialog.expectClosed();

  await demo.settingsTabs.expectActive('General');
  await demo.settingsTabs.open('Advanced');
  await demo.settingsTabs.expectActive('Advanced');

  expect(emittedEvents().map((e) => e.sentence)).toEqual([
    'Assert dialog "Confirm export" is closed',
    'Click button "Confirm export"',
    'Assert dialog "Confirm export" is open',
    'Close dialog "Confirm export"',
    'Assert dialog "Confirm export" is closed',
    'Assert tabs "Settings" has active tab "General"',
    'Open tab "Advanced" in tabs "Settings"',
    'Assert tabs "Settings" has active tab "Advanced"',
  ]);
});

test('failing tier-2 assertions report expected and actual', async ({ page }) => {
  const demo = new DemoPage(page);

  await expect(demo.settingsTabs.expectActive('Advanced')).rejects.toThrow();
  await expect(demo.exportHistory.expectRowCount(5)).rejects.toThrow();

  const failed = emittedEvents().filter((e) => e.status === 'failed');
  expect(failed[0]).toMatchObject({
    action: 'assert-active-tab',
    sentence: 'Assert tabs "Settings" has active tab "Advanced"',
    expected: 'Advanced',
    actual: 'General',
  });
  expect(failed[1]).toMatchObject({
    action: 'assert-row-count',
    sentence: 'Assert table "Export history" has 5 rows',
    expected: '5',
    actual: '2',
  });
});
