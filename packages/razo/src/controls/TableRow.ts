import type { Page } from '@playwright/test';
import { Control, type ControlOptions, type LocatorSpec } from './Control';
import { Button } from './Button';
import { Link } from './Link';
import { Input } from './Input';
import { Checkbox } from './Checkbox';

/** A single table cell, for read-only text assertions (inherits expectText). */
export class Cell extends Control {
  protected readonly controlType = 'cell';
}

/** One <tbody> row. Scopes child controls to itself via `within`. */
export class TableRow extends Control {
  protected readonly controlType = 'row';

  button(name: string): Button {
    return new Button(this.page, { role: 'button', name }, name, { within: this });
  }

  link(name: string): Link {
    return new Link(this.page, { role: 'link', name }, name, { within: this });
  }

  input(name: string): Input {
    return new Input(this.page, { role: 'textbox', name }, name, { within: this });
  }

  checkbox(name: string): Checkbox {
    return new Checkbox(this.page, { role: 'checkbox', name }, name, { within: this });
  }

  cell(index: number): Cell {
    return new Cell(this.page, { css: `:scope > td:nth-child(${index + 1})` }, `cell #${index}`, {
      within: this,
    });
  }

  control<C extends Control>(
    Ctor: new (page: Page, locate: LocatorSpec, name: string, options?: ControlOptions) => C,
    locate: LocatorSpec,
    name: string,
  ): C {
    return new Ctor(this.page, locate, name, { within: this });
  }
}
