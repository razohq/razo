import { test } from '@playwright/test';
import { Button, Label } from '../../../src';

test('placing an order when the API is down', async ({ page }) => {
  await page.route('https://shop.test/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<button data-testid="place">Place order</button><p data-testid="status" aria-label="Status"></p>
      <script>
        document.querySelector('[data-testid=place]').onclick = async () => {
          const res = await fetch('/api/orders', { method: 'POST' });
          if (!res.ok) console.error('order failed: ' + res.status);
        };
      </script>`,
  }));
  await page.route('https://shop.test/api/orders', (route) => route.fulfill({ status: 500, body: '' }));
  await page.goto('https://shop.test/');
  await new Button(page, 'place', 'Place order').click();
  await page.waitForTimeout(300);
  // Logged while the assertion is waiting: after the failure moment it would not be the first anomaly anyway.
  await page.evaluate(() => setTimeout(() => console.error('late noise'), 100));
  await new Label(page, 'status', 'Status').expectText('Order placed');
});
