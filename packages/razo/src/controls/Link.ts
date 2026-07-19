import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

export class Link extends Control {
  protected readonly controlType = 'link';

  async open(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('open', options, () => this.locator.click());
  }

  async expectHref(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-href',
      {
        ...options,
        expected,
        readActual: async () => (await this.locator.getAttribute('href')) ?? 'none',
      },
      () => expect(this.locator).toHaveAttribute('href', expected),
    );
  }
}
