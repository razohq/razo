import { test, expect, type Page } from '@playwright/test';
import { TableRow } from '../src/controls/TableRow';
import { AI_STEP_ATTACHMENT, type StepEvent } from '../src/reporting/events';

function emittedEvents(): StepEvent[] {
  return test.info().attachments
    .filter((a) => a.name === AI_STEP_ATTACHMENT)
    .map((a) => JSON.parse(a.body!.toString()) as StepEvent);
}

const TABLE = `
  <table data-testid="exports">
    <thead><tr><th>File</th><th>Action</th></tr></thead>
    <tbody>
      <tr><td>mi-llavero.3mf</td><td><button>Delete</button></td></tr>
      <tr><td>base.3mf</td><td><button disabled>Delete</button></td></tr>
    </tbody>
  </table>`;

// Build a TableRow directly over one <tr> (Table's finders do this in Task 3).
function rowFor(page: Page, hasText: string): TableRow {
  const locator = page.getByTestId('exports').locator('tbody tr').filter({ hasText }).first();
  return new TableRow(page, { locator }, hasText);
}

test('a row helper button is scoped to that row and narrates the row context', async ({ page }) => {
  await page.setContent(TABLE);
  await rowFor(page, 'mi-llavero.3mf').button('Delete').click(); // enabled → passes

  const [event] = emittedEvents();
  expect(event).toMatchObject({
    status: 'passed',
    sentence: 'Click button "Delete" in row "mi-llavero.3mf"',
  });
});

test('the same helper on another row targets that row (disabled → fails there)', async ({ page }) => {
  await page.setContent(TABLE);
  await expect(rowFor(page, 'base.3mf').button('Delete').click()).rejects.toThrow();
});

test('cell(index) asserts the nth cell text, scoped to the row', async ({ page }) => {
  await page.setContent(TABLE);
  await rowFor(page, 'mi-llavero.3mf').cell(0).expectText('mi-llavero.3mf');

  const [event] = emittedEvents();
  expect(event.status).toBe('passed');
  expect(event.sentence).toContain('in row "mi-llavero.3mf"');
});
