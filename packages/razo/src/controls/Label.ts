import { Control } from './Control';

/**
 * Read-only element (status messages, headings). It has no actions:
 * it exists so outcome verifications are narrated too.
 */
export class Label extends Control {
  protected readonly controlType = 'label';
}
