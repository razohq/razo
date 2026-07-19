import { Input } from './Input';

/** Same behavior as Input; only the narration names it differently. */
export class TextArea extends Input {
  protected override readonly controlType = 'text area';
}
