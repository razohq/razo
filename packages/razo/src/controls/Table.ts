import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

/** Read-only table assertions over tbody rows. */
export class Table extends Control {
  protected readonly controlType = 'table';

  private rows() {
    return this.locator.locator('tbody tr');
  }

  async expectRowCount(expected: number, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-row-count',
      {
        ...options,
        expected: String(expected),
        readActual: async () => String(await this.rows().count()),
      },
      () => expect(this.rows()).toHaveCount(expected),
    );
  }

  async expectRowContains(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-row-contains',
      {
        ...options,
        expected,
        readActual: async () => `${await this.rows().count()} rows, none matching`,
      },
      () => expect(this.rows().filter({ hasText: expected }).first()).toBeVisible(),
    );
  }
}
