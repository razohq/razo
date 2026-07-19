import { Control, type StepOptions } from './Control';

/**
 * Dropdown menu: the testId points at the trigger button; menu items are
 * looked up by role anywhere on the page (menus often render in portals).
 */
export class Menu extends Control {
  protected readonly controlType = 'menu';

  async choose(item: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step('choose', { ...options, detail: item }, async () => {
      await this.locator.click();
      await this.page.getByRole('menuitem', { name: item }).click();
    });
  }
}
