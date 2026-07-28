import { expect, type Locator, type Page } from '@playwright/test';
import { Control, type ControlOptions, type LocatorSpec, type StepOptions } from './Control';
import { TableRow } from './TableRow';

type RowCtor<TRow extends TableRow> = new (
  page: Page,
  locate: LocatorSpec,
  name: string,
  options?: ControlOptions,
) => TRow;

/** Row assertions plus row access. Subclass with a bound `rowClass` for typed rows. */
export class Table<TRow extends TableRow = TableRow> extends Control {
  protected readonly controlType = 'table';
  protected rowClass: RowCtor<TRow> = TableRow as RowCtor<TRow>;

  private rowsLocator(): Locator {
    return this.locator.locator('tbody tr');
  }

  private makeRow(locator: Locator, name: string): TRow {
    return new this.rowClass(this.page, { locator }, name, {});
  }

  /** A row by cell text, or by 0-based index. */
  row(textOrIndex: string | number): TRow {
    if (typeof textOrIndex === 'number') {
      return this.makeRow(this.rowsLocator().nth(textOrIndex), `row #${textOrIndex}`);
    }
    return this.makeRow(this.rowsLocator().filter({ hasText: textOrIndex }).first(), textOrIndex);
  }

  /** All rows, in DOM order. */
  async rows(): Promise<TRow[]> {
    const count = await this.rowsLocator().count();
    return Array.from({ length: count }, (_, i) =>
      this.makeRow(this.rowsLocator().nth(i), `row #${i}`),
    );
  }

  async expectRowCount(expected: number, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-row-count',
      { ...options, expected: String(expected), readActual: async () => String(await this.rowsLocator().count()) },
      () => expect(this.rowsLocator()).toHaveCount(expected),
    );
  }

  async expectRowContains(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-row-contains',
      { ...options, expected, readActual: async () => `${await this.rowsLocator().count()} rows, none matching` },
      () => expect(this.rowsLocator().filter({ hasText: expected }).first()).toBeVisible(),
    );
  }
}
