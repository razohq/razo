import { test, expect } from '@playwright/test';
import { Input } from '../../../src';

test('fills a password field and an ordinary one', async ({ page }) => {
  // A React-style listener: the value only counts once an input event says so.
  await page.setContent(`
    <input data-testid="password" type="password" aria-label="Password">
    <input data-testid="email" type="email" aria-label="Email">
    <output data-testid="seen"></output>
    <script>
      document.querySelector('[data-testid=password]').addEventListener('input', (e) => {
        document.querySelector('[data-testid=seen]').textContent = 'input:' + e.target.value.length;
      });
    </script>
  `);
  await page.getByTestId('password').fill('old-value');
  await new Input(page, 'password', 'Password').fill('hunter2-hunter2');
  await new Input(page, 'email', 'Email').fill('ana@example.com');
  await expect(page.getByTestId('password')).toHaveValue('hunter2-hunter2');
  await expect(page.getByTestId('seen')).toHaveText('input:15');
});
