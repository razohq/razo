import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

/** Radio group: the testId points at the group container. */
export class RadioButton extends Control {
  protected readonly controlType = 'radio group';

  async select(option: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('select', { ...options, detail: option }, () =>
      this.locator.getByRole('radio', { name: option }).check(),
    );
  }

  async expectSelected(option: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-selected',
      {
        ...options,
        expected: option,
        readActual: () =>
          this.locator
            .locator('input[type="radio"]')
            .evaluateAll(
              (radios) =>
                (radios.find((r) => (r as HTMLInputElement).checked) as HTMLInputElement)?.value ??
                'none',
            ),
      },
      () => expect(this.locator.getByRole('radio', { name: option })).toBeChecked(),
    );
  }
}
