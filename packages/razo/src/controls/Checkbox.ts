import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

export class Checkbox extends Control {
  protected readonly controlType = 'checkbox';

  private readActualState = async () =>
    (await this.locator.isChecked()) ? 'checked' : 'unchecked';

  async expectChecked(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-checked',
      { ...options, expected: 'checked', readActual: this.readActualState },
      () => expect(this.locator).toBeChecked(),
    );
  }

  async expectUnchecked(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-unchecked',
      { ...options, expected: 'unchecked', readActual: this.readActualState },
      () => expect(this.locator).not.toBeChecked(),
    );
  }

  async check(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('check', options, () => this.locator.check());
  }

  async uncheck(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('uncheck', options, () => this.locator.uncheck());
  }
}
