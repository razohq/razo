import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

/** Native input[type="date"]; dates travel in ISO format (YYYY-MM-DD). */
export class DatePicker extends Control {
  protected readonly controlType = 'date picker';

  async pick(isoDate: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('pick-date', { ...options, detail: isoDate }, () =>
      this.locator.fill(isoDate),
    );
  }

  async expectDate(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-value',
      { ...options, expected, readActual: () => this.locator.inputValue() },
      () => expect(this.locator).toHaveValue(expected),
    );
  }
}
