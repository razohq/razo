import { Control, type StepOptions } from './Control';

/** contenteditable region. Inherits expectText/expectContainsText from the base. */
export class Editor extends Control {
  protected readonly controlType = 'editor';

  async write(text: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('fill', { ...options, detail: text }, () => this.locator.fill(text));
  }

  async clear(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('clear', options, () => this.locator.fill(''));
  }
}
