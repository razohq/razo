import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

/** ARIA tablist: the testId points at the tablist container. */
export class Tabs extends Control {
  protected readonly controlType = 'tabs';

  async open(tab: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('open-tab', { ...options, detail: tab }, () =>
      this.locator.getByRole('tab', { name: tab }).click(),
    );
  }

  async expectActive(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-active-tab',
      {
        ...options,
        expected,
        readActual: async () =>
          (
            (await this.locator
              .locator('[role="tab"][aria-selected="true"]')
              .first()
              .textContent()) ?? 'none'
          ).trim(),
      },
      () =>
        expect(this.locator.getByRole('tab', { name: expected })).toHaveAttribute(
          'aria-selected',
          'true',
        ),
    );
  }
}
