import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

type FieldOptions = Pick<StepOptions, 'as' | 'sensitive'>;

export class Input extends Control {
  protected readonly controlType: string = 'field';

  /**
   * Whether the field's value is a secret: the caller's `sensitive` when
   * given, else a password or one-time-code input on the page. It does not
   * wait for the element, so a field that is not there yet is not detected;
   * pass `sensitive: true` to be sure.
   */
  private async isSensitive(options: FieldOptions): Promise<boolean> {
    if (options.sensitive !== undefined) return options.sensitive;
    return this.locator
      .evaluateAll((els) => els.some((el) => el instanceof HTMLInputElement
        && (el.type === 'password' || /^(current-password|new-password|one-time-code)$/.test(el.autocomplete))))
      .catch(() => false);
  }

  /** For a field, "text" means its value, not its DOM content. */
  override async expectText(expected: string, options: FieldOptions = {}) {
    await this.step(
      'assert-text',
      { ...options, sensitive: await this.isSensitive(options), expected, readActual: () => this.locator.inputValue() },
      () => expect(this.locator).toHaveValue(expected),
    );
  }

  async fill(value: string, options: FieldOptions = {}) {
    await this.step('fill', { ...options, sensitive: await this.isSensitive(options), detail: value }, () => this.locator.fill(value));
  }

  async clear(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('clear', options, () => this.locator.clear());
  }

  async expectEmpty(options: FieldOptions = {}) {
    await this.step(
      'assert-empty',
      { ...options, sensitive: await this.isSensitive(options), expected: 'empty', readActual: () => this.locator.inputValue() },
      () => expect(this.locator).toHaveValue(''),
    );
  }
}
