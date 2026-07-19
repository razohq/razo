import { test, expect } from '@playwright/test';
import { DemoPage } from '../pages/DemoPage';
import { AI_STEP_ATTACHMENT, type StepEvent } from '../src';

function emittedSentences(): string[] {
  return test
    .info()
    .attachments.filter((a) => a.name === AI_STEP_ATTACHMENT)
    .map((a) => (JSON.parse(a.body!.toString()) as StepEvent).sentence);
}

test('every control narrates its action with the grammar sentence', async ({ page }) => {
  const demo = new DemoPage(page);
  await demo.goto();

  await demo.filename.fill('mi-llavero');
  await demo.filename.clear();
  await demo.filename.fill('llavero-v2');
  await demo.format.choose('3MF');
  await demo.quality.select('Fine');
  await demo.includeSupports.check();
  await demo.includeSupports.uncheck();
  await demo.exportButton.click();
  await demo.helpLink.open();

  expect(emittedSentences()).toEqual([
    'Type "mi-llavero" into field "Filename"',
    'Clear field "Filename"',
    'Type "llavero-v2" into field "Filename"',
    'Choose "3MF" in select "Format"',
    'Select option "Fine" in radio group "Quality"',
    'Check checkbox "Include supports"',
    'Uncheck checkbox "Include supports"',
    'Click button "Export"',
    'Open link "Help"',
  ]);

  // The actions really went through the UI: the export ran and help opened.
  await expect(page.getByTestId('status')).toHaveText('Exported llavero-v2.3mf (Fine)');
  await expect(page.getByTestId('help-section')).toBeVisible();
});
