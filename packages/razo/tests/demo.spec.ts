import { test } from '@playwright/test';
import { Button } from '../src/controls/Button';
import { DemoPage } from '../pages/DemoPage';

test('export a 3MF model', async ({ page }) => {
  const demo = new DemoPage(page);
  await demo.goto();

  await demo.exportButton.expectVisible();
  await demo.uploadButton.expectDisabled();

  await demo.filename.fill('mi-llavero');
  await demo.format.choose('3MF');
  await demo.quality.select('Standard');
  await demo.includeSupports.check();
  await demo.includeSupports.expectChecked();

  await demo.exportButton.click({ as: 'Confirm the export' });
  await demo.status.expectText('Exported mi-llavero.3mf (Standard)');
});

// Deliberate failure: quality is never chosen, so the export never happens.
// The narration (HTML + razo-steps.json) has to tell exactly that story.
test('export a model without choosing quality', async ({ page }) => {
  test.fail(); // the failure is the artifact we want to showcase

  const demo = new DemoPage(page);
  await demo.goto();

  await demo.filename.fill('mi-llavero');
  await demo.format.choose('3MF');
  await demo.exportButton.click();
  await demo.status.expectText('Exported mi-llavero.3mf (Standard)');
});

// Showcase: the export button's testid was "renamed" (v0 no longer exists).
// Deterministic healing finds it by role + accessible name; the step passes
// and the artifact records the drift for the AI analysis.
test('export still works after the export button was renamed (healed locator)', async ({ page }) => {
  const demo = new DemoPage(page);
  await demo.goto();

  await demo.filename.fill('mi-llavero');
  await demo.format.choose('3MF');
  await demo.quality.select('Standard');

  const renamedExport = new Button(page, 'export-v0', 'Export');
  await renamedExport.click();
  await demo.status.expectText('Exported mi-llavero.3mf (Standard)');
});
