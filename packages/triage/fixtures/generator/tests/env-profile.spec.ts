import { test } from '@playwright/test';
import { Label } from '@razohq/razo';

// Nothing listens on 127.0.0.1:65531 on a dev machine: every navigation is
// refused and five files fail together, which is the environment rule's
// signature. (Low ports such as 9 are on Chromium's unsafe-port list and fail
// with ERR_UNSAFE_PORT instead, which is not a connection error.)
test('profile page loads @environment', async ({ page }) => {
  await page.goto('http://127.0.0.1:65531/profile');
  await new Label(page, 'heading', 'profile heading').expectVisible();
});
