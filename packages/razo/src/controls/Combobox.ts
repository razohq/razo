import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

/**
 * ARIA combobox: the testId points at the text input; options are looked up
 * by role anywhere on the page (comboboxes often render their listbox in a
 * portal outside the input's subtree).
 */
export class Combobox extends Control {
  protected readonly controlType = 'combobox';

  async search(text: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('fill', { ...options, detail: text }, () => this.locator.fill(text));
  }

  async pick(option: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('pick', { ...options, detail: option }, () =>
      this.page.getByRole('option', { name: option }).click(),
    );
  }

  async expectSelected(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-value',
      { ...options, expected, readActual: () => this.locator.inputValue() },
      () => expect(this.locator).toHaveValue(expected),
    );
  }
}
