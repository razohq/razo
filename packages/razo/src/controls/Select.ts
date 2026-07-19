import { Control, type StepOptions } from './Control';

export class Select extends Control {
  protected readonly controlType = 'select';

  /** Chooses an option by its visible label. */
  async choose(option: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('choose', { ...options, detail: option }, async () => {
      await this.locator.selectOption({ label: option });
    });
  }

  /** Chooses several options by label (for <select multiple>). */
  async chooseMany(optionLabels: string[], options: Pick<StepOptions, 'as'> = {}) {
    await this.step('choose-many', { ...options, detail: optionLabels.join(', ') }, async () => {
      await this.locator.selectOption(optionLabels.map((label) => ({ label })));
    });
  }
}
