import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

/**
 * Tooltip: the testId points at the TRIGGER element. The tooltip content is
 * resolved through the trigger's aria-describedby (the accessible pattern),
 * so it works wherever the tooltip node is rendered.
 */
export class Tooltip extends Control {
  protected readonly controlType = 'tooltip';

  private async tooltipText(): Promise<string> {
    const id = await this.locator.getAttribute('aria-describedby');
    if (!id) return 'no tooltip';
    const text = await this.page.locator(`#${id}`).textContent();
    return (text ?? '').trim() || 'no tooltip';
  }

  /** Hovers the trigger and asserts the tooltip content. */
  async expectContent(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-tooltip',
      { ...options, expected, readActual: () => this.tooltipText() },
      async () => {
        await this.locator.hover();
        const id = await this.locator.getAttribute('aria-describedby');
        if (!id) throw new Error('trigger has no aria-describedby tooltip');
        await expect(this.page.locator(`#${id}`)).toBeVisible();
        await expect(this.page.locator(`#${id}`)).toHaveText(expected);
      },
    );
  }
}
