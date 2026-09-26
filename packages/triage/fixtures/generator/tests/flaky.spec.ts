import * as path from 'path';
import { test } from '@playwright/test';
import { Button, Input, Label, RadioButton, Select } from '@razohq/razo';

const DEMO_URL = 'file://' + path.resolve(__dirname, '../../../../razo/fixtures/demo.html');

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL);
});

test('exporting a model succeeds @flaky', async ({ page }, testInfo) => {
  await new Input(page, 'filename', 'Filename').fill('flaky-keychain');
  await new Select(page, 'format', 'Format').choose('3MF');
  await new RadioButton(page, 'quality', 'Quality').select('Standard');
  // First attempt points at a testid that never existed: the click times out
  // and razo records a real locator failure. Retries use the right one.
  const exportId = testInfo.retry === 0 ? 'export-v0' : 'export';
  process.env.RAZO_HEALING = 'off';
  await new Button(page, exportId, 'Export').click();
  await new Label(page, 'status', 'Export status').expectText('Exported flaky-keychain.3mf (Standard)');
});

test('the export button is on the page @flaky', async ({ page }) => {
  await new Button(page, 'export', 'Export').expectVisible();
});
