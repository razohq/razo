import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

export class Input extends Control {
  protected readonly controlType: string = 'field';

  /** For a field, "text" means its value, not its DOM content. */
  override async expectText(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-text',
      { ...options, expected, readActual: () => this.locator.inputValue() },
      () => expect(this.locator).toHaveValue(expected),
    );
  }

  async fill(value: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('fill', { ...options, detail: value }, () => this.locator.fill(value));
  }

  async clear(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('clear', options, () => this.locator.clear());
  }

  async expectEmpty(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-empty',
      { ...options, expected: 'empty', readActual: () => this.locator.inputValue() },
      () => expect(this.locator).toHaveValue(''),
    );
  }
}
