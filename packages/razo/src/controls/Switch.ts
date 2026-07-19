import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

/** ARIA switch (role="switch" with aria-checked). Actions are idempotent. */
export class Switch extends Control {
  protected readonly controlType = 'switch';

  private readState = async () =>
    (await this.locator.getAttribute('aria-checked')) === 'true' ? 'on' : 'off';

  async turnOn(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('turn-on', options, async () => {
      if ((await this.readState()) !== 'on') await this.locator.click();
      await expect(this.locator).toHaveAttribute('aria-checked', 'true');
    });
  }

  async turnOff(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('turn-off', options, async () => {
      if ((await this.readState()) !== 'off') await this.locator.click();
      await expect(this.locator).toHaveAttribute('aria-checked', 'false');
    });
  }

  async expectOn(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-on',
      { ...options, expected: 'on', readActual: this.readState },
      () => expect(this.locator).toHaveAttribute('aria-checked', 'true'),
    );
  }

  async expectOff(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-off',
      { ...options, expected: 'off', readActual: this.readState },
      () => expect(this.locator).toHaveAttribute('aria-checked', 'false'),
    );
  }
}
