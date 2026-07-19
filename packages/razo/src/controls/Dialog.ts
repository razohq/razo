import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

/** Native <dialog> or role="dialog". close() sends Escape. */
export class Dialog extends Control {
  protected readonly controlType = 'dialog';

  private readState = async () => ((await this.locator.isVisible()) ? 'open' : 'closed');

  async close(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('close', options, async () => {
      await this.page.keyboard.press('Escape');
      await expect(this.locator).toBeHidden();
    });
  }

  async expectOpen(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-open',
      { ...options, expected: 'open', readActual: this.readState },
      () => expect(this.locator).toBeVisible(),
    );
  }

  async expectClosed(options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-closed',
      { ...options, expected: 'closed', readActual: this.readState },
      () => expect(this.locator).toBeHidden(),
    );
  }
}
