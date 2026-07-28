import { test, expect, type Page } from '@playwright/test';
import { TableRow } from '../src/controls/TableRow';
import { Table } from '../src/controls/Table';
import { Button } from '../src/controls/Button';
import { Label } from '../src/controls/Label';
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
  await expect(rowFor(page, 'base.3mf').button('Delete').click())
    .rejects.toThrow(/not enabled|disabled|Timeout/i);
});

test('cell(index) asserts the nth cell text, scoped to the row', async ({ page }) => {
  await page.setContent(TABLE);
  await rowFor(page, 'mi-llavero.3mf').cell(0).expectText('mi-llavero.3mf');

  const [event] = emittedEvents();
  expect(event.status).toBe('passed');
  expect(event.sentence).toContain('in row "mi-llavero.3mf"');
});

test('Table.row(text) returns a usable TableRow', async ({ page }) => {
  await page.setContent(TABLE);
  const table = new Table(page, 'exports', 'Exports');
  await table.row('mi-llavero.3mf').button('Delete').click();

  const [event] = emittedEvents();
  expect(event.sentence).toBe('Click button "Delete" in row "mi-llavero.3mf"');
});

test('Table.row(index) targets the 0-based row', async ({ page }) => {
  await page.setContent(TABLE);
  const table = new Table(page, 'exports', 'Exports');
  await table.row(0).cell(0).expectText('mi-llavero.3mf');
  expect(emittedEvents()[0].status).toBe('passed');
});

test('Table.rows() returns all rows', async ({ page }) => {
  await page.setContent(TABLE);
  const rows = await new Table(page, 'exports', 'Exports').rows();
  expect(rows).toHaveLength(2);
  await rows[1].cell(0).expectText('base.3mf');
});

test('input and checkbox helpers scope to the row and narrate row context', async ({ page }) => {
  await page.setContent(`
    <table data-testid="cart">
      <tbody>
        <tr>
          <td>Widget</td>
          <td><input aria-label="Qty" value="1"></td>
          <td><input type="checkbox" aria-label="Select"></td>
        </tr>
      </tbody>
    </table>`);
  const locator = page.getByTestId('cart').locator('tbody tr').filter({ hasText: 'Widget' }).first();
  const row = new TableRow(page, { locator }, 'Widget');

  await row.input('Qty').fill('3');
  await row.checkbox('Select').check();

  const events = emittedEvents();
  expect(events.some((e) => e.sentence.includes('in row "Widget"'))).toBe(true);
  expect(events.some((e) => e.action === 'fill' && e.status === 'passed')).toBe(true);
  expect(events.some((e) => e.action === 'check' && e.status === 'passed')).toBe(true);
});

test('a Table<TRow> subclass returns the custom row type', async ({ page }) => {
  class ExportRow extends TableRow {
    delete = new Button(this.page, { role: 'button', name: 'Delete' }, 'Delete', { within: this });
    file = new Label(this.page, { css: 'td:nth-child(1)' }, 'File', { within: this });
  }
  class ExportsTable extends Table<ExportRow> {
    protected rowClass = ExportRow;
  }
  await page.setContent(TABLE);
  const row = new ExportsTable(page, 'exports', 'Exports').row('mi-llavero.3mf');
  await row.file.expectText('mi-llavero.3mf'); // typed field access
  expect(emittedEvents()[0].sentence).toContain('in row "mi-llavero.3mf"');
});
