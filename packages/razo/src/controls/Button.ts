import { Control, type StepOptions } from './Control';

export class Button extends Control {
  protected readonly controlType = 'button';

  async click(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('click', options, () => this.locator.click());
  }
}
