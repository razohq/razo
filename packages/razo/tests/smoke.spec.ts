import { test, expect } from '@playwright/test';
import { DEMO_URL } from '../fixtures/demoUrl';

test('demo page loads', async ({ page }) => {
  await page.goto(DEMO_URL);
  await expect(page).toHaveTitle('Model Exporter');
});
