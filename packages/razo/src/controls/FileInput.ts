import * as path from 'path';
import { expect } from '@playwright/test';
import { Control, type StepOptions } from './Control';

export class FileInput extends Control {
  protected readonly controlType = 'file input';

  /** Attaches one or more files by path. The narration shows the file names. */
  async attach(files: string | string[], options: Pick<StepOptions, 'as'> = {}) {
    const list = Array.isArray(files) ? files : [files];
    const names = list.map((f) => path.basename(f)).join(', ');
    await this.step('attach', { ...options, detail: names }, () =>
      this.locator.setInputFiles(list),
    );
  }

  async clear(options: Pick<StepOptions, 'as'> = {}) {
    await this.step('clear', options, () => this.locator.setInputFiles([]));
  }

  /** Asserts the name of the file currently selected. */
  async expectFile(expectedName: string, options: Pick<StepOptions, 'as'> = {}) {
    const readSelectedName = () =>
      this.locator.evaluate(
        (el) => (el as HTMLInputElement).files?.[0]?.name ?? 'none',
      );
    await this.step(
      'assert-value',
      { ...options, expected: expectedName, readActual: readSelectedName },
      () => expect.poll(readSelectedName).toBe(expectedName),
    );
  }
}
