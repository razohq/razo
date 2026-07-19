import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

export class Image extends Control {
  protected readonly controlType = 'image';

  async expectAlt(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-alt',
      {
        ...options,
        expected,
        readActual: async () => (await this.locator.getAttribute('alt')) ?? 'none',
      },
      () => expect(this.locator).toHaveAttribute('alt', expected),
    );
  }

  async expectLoaded(options: Pick<StepOptions, 'as'> = {}) {
    const isLoaded = () =>
      this.locator.evaluate(
        (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
      );
    await this.step(
      'assert-loaded',
      {
        ...options,
        expected: 'loaded',
        readActual: async () => ((await isLoaded()) ? 'loaded' : 'not loaded'),
      },
      () => expect.poll(isLoaded).toBe(true),
    );
  }
}
