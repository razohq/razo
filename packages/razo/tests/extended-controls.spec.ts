import * as fs from 'fs';
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

test('file input, slider, textarea and multi-select narrate their actions', async ({
  page,
}, testInfo) => {
  const demo = new DemoPage(page);

  const model = testInfo.outputPath('keychain.stl');
  fs.writeFileSync(model, 'solid keychain');
  await demo.modelFile.attach(model);
  await demo.modelFile.expectFile('keychain.stl');

  await demo.scale.setValue(150);
  await demo.scale.expectValue(150);
  await demo.scaleValue.expectText('150'); // the app really heard the input event

  await demo.notes.fill('two-color print');
  await demo.notes.expectText('two-color print');

  await demo.extraFormats.chooseMany(['STL', 'STEP']);

  await demo.helpLink.expectHref('#help');

  expect(emittedEvents().map((e) => e.sentence)).toEqual([
    'Attach "keychain.stl" to file input "Model file"',
    'Assert file input "Model file" has value "keychain.stl"',
    'Set slider "Scale" to "150"',
    'Assert slider "Scale" has value "150"',
    'Assert label "Scale value" has text "150"',
    'Type "two-color print" into text area "Notes"',
    'Assert text area "Notes" has text "two-color print"',
    'Choose options "STL, STEP" in select "Also export as"',
    'Assert link "Help" points to "#help"',
  ]);

  // The multi-select really holds both options.
  const selected = await demo.extraFormats.locator.evaluate((el) =>
    Array.from((el as HTMLSelectElement).selectedOptions).map((o) => o.label),
  );
  expect(selected).toEqual(['STL', 'STEP']);
});

test('failing extended assertions report expected and actual', async ({ page }) => {
  const demo = new DemoPage(page);

  await demo.scale.setValue(80);
  await expect(demo.scale.expectValue(150)).rejects.toThrow();

  const failed = emittedEvents().find((e) => e.status === 'failed')!;
  expect(failed).toMatchObject({
    action: 'assert-value',
    sentence: 'Assert slider "Scale" has value "150"',
    expected: '150',
    actual: '80',
    status: 'failed',
  });
});
