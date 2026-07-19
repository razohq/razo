import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

export class Slider extends Control {
  protected readonly controlType = 'slider';

  /**
   * Sets the slider value. Range inputs cannot be filled, so the value is
   * set in the DOM and the input/change events the app listens to are fired.
   */
  async setValue(value: number | string, options: Pick<StepOptions, 'as'> = {}) {
    const detail = String(value);
    await this.step('set', { ...options, detail }, async () => {
      await expect(this.locator).toBeVisible();
      await this.locator.evaluate((el, v) => {
        const input = el as HTMLInputElement;
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, detail);
    });
  }

  async expectValue(expected: number | string, options: Pick<StepOptions, 'as'> = {}) {
    const value = String(expected);
    await this.step(
      'assert-value',
      { ...options, expected: value, readActual: () => this.locator.inputValue() },
      () => expect(this.locator).toHaveValue(value),
    );
  }
}
