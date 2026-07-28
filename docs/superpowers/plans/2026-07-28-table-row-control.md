# TableRow control + `Table<TRow>` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make components inside table rows first-class — table finders return a `TableRow` (subclassable), scoped helpers reach a row's contents, and narration says which row acted.

**Architecture:** `TableRow extends Control` represents one `<tbody> <tr>` and scopes child controls via the existing `within` mechanism. `Table<TRow>` gains a `rowClass` and finders (`row(text)`, `row(index)`, `rows()`). `Control.step()` appends an `in <parent> "<name>"` clause to the grammar sentence when a control has a `within` parent.

**Tech Stack:** TypeScript, Playwright, Vitest-style Playwright test runner. Repo: `packages/razo` in `github.com/razohq/razo`.

## Global Constraints

- Work only in `packages/razo`. Do not touch `packages/razo-analyzer` or the CLIs.
- Helpers locate **by accessible role + name**; the generic `control()` accepts any `LocatorSpec`.
- Row/cell indices are **0-based** (match `.nth()` and JS arrays).
- Narration: the `in <parentType> "<parentName>"` clause is appended to the grammar sentence only; the existing `as` option still replaces the whole sentence (the opt-out). Immediate parent only.
- Every control needs a non-empty `name` (the `Control` constructor throws otherwise).
- Tests use `page.setContent(...)` and read emitted `StepEvent`s via the `emittedEvents()` pattern in `tests/control-base.spec.ts`.
- Run the package test suite from `packages/razo`: `npx playwright test` (or the repo's configured test command).

---

### Task 1: `within` narration clause in `Control.step()`

**Files:**
- Modify: `packages/razo/src/controls/Control.ts` (the `step()` sentence line, ~271)
- Modify: `packages/razo/tests/control-base.spec.ts` (add a within-narration test)
- Modify: `packages/razo/tests/healing.spec.ts`, `packages/razo/tests/locators.spec.ts` (update existing `within` sentence assertions)

**Interfaces:**
- Consumes: `Control` constructor `(page, locate, name, options)`, `options.within`, `SENTENCES`, `this.parent`, `this.parent.controlType`, `this.parent.name`.
- Produces: for any control with a `within` parent, `step()` emits a sentence ending ` in <parentType> "<parentName>"` unless `options.as` is set.

- [ ] **Step 1: Write the failing test** in `tests/control-base.spec.ts`

Add, reusing the file's existing `ProbeControl` + `emittedEvents()` helpers and `DEMO_URL` fixture:

```ts
test('a control within a parent appends the parent context to the sentence', async ({ page }) => {
  const parent = new ProbeControl(page, 'export', 'Export');
  const child = new ProbeControl(page, 'confirm', 'Confirm', { within: parent });
  await child.succeed(); // emits a 'click' step

  const [event] = emittedEvents();
  expect(event.sentence).toBe('Click button "Confirm" in button "Export"');
});

test('an explicit `as` overrides the auto within-context entirely', async ({ page }) => {
  const parent = new ProbeControl(page, 'export', 'Export');
  const child = new ProbeControl(page, 'confirm', 'Confirm', { within: parent });
  await child.businessOverride(); // step('click', { as: 'Confirm the export' })

  const [event] = emittedEvents();
  expect(event.sentence).toBe('Confirm the export');
});
```

`ProbeControl`'s constructor currently is `(page, testId, name)`. Widen it to accept options so the test can pass `within`:

```ts
class ProbeControl extends Control {
  protected readonly controlType = 'button';
  constructor(page: Page, testId: string, name: string, options?: ControlOptions) {
    super(page, testId, name, options);
  }
  // ...succeed()/fail()/businessOverride() unchanged
}
```

Add `type ControlOptions` to the import from `../src/controls/Control`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/razo && npx playwright test control-base`
Expected: the new within test FAILs (`Click button "Confirm"` has no ` in button "Export"` yet); the `as` test passes already.

- [ ] **Step 3: Implement the clause in `Control.ts`**

At the `step()` sentence line (currently `const sentence = options.as ?? SENTENCES[action](context);`), replace with:

```ts
    const base = SENTENCES[action](context);
    const scoped = this.parent
      ? `${base} in ${this.parent.controlType} "${this.parent.name}"`
      : base;
    const sentence = options.as ?? scoped;
```

(`this.parent.controlType` is a protected member accessed on another `Control` from within `Control` — allowed by TypeScript.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/razo && npx playwright test control-base`
Expected: both new tests PASS.

- [ ] **Step 5: Update the two existing `within` sentence assertions**

Run `npx playwright test healing locators` and fix any sentence assertion that now includes the appended ` in <type> "<name>"` clause — update the expected string to match the new (correct) sentence. Do not weaken the assertion; update it to the full new sentence.

Run: `cd packages/razo && npx playwright test`
Expected: full suite PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/razo/src/controls/Control.ts packages/razo/tests/control-base.spec.ts packages/razo/tests/healing.spec.ts packages/razo/tests/locators.spec.ts
git commit -m "Control: narrate within-context (\"... in <parent> \\\"name\\\"\")"
```

---

### Task 2: `TableRow` + `Cell` with scoped helpers

**Files:**
- Create: `packages/razo/src/controls/TableRow.ts`
- Create: `packages/razo/tests/table-row.spec.ts`

**Interfaces:**
- Consumes: `Control`, `ControlOptions`, `LocatorSpec`, `StepOptions` from `./Control`; `Button`, `Link`, `Input`, `Checkbox` from their control files; the `within` scoping + Task 1 narration.
- Produces:
  - `class Cell extends Control` (`controlType = 'cell'`) — inherits `expectText`/`expectContainsText` from `Control`.
  - `class TableRow extends Control` (`controlType = 'row'`) with methods:
    - `button(name: string): Button`
    - `link(name: string): Link`
    - `input(name: string): Input`
    - `checkbox(name: string): Checkbox`
    - `cell(index: number): Cell`
    - `control<C extends Control>(Ctor: new (page: Page, locate: LocatorSpec, name: string, options?: ControlOptions) => C, locate: LocatorSpec, name: string): C`
  - Every helper scopes the child with `{ within: this }`.

- [ ] **Step 1: Write the failing test** in `tests/table-row.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test';
import { TableRow } from '../src/controls/TableRow';
import { AI_STEP_ATTACHMENT, type StepEvent } from '../src/reporting/events';

function emittedEvents(): StepEvent[] {
  return test.info().attachments
    .filter((a) => a.name === AI_STEP_ATTACHMENT)
    .map((a) => JSON.parse(a.body!.toString()) as StepEvent);
}

const TABLE = `
  <table data-testid="exports">
    <thead><tr><th>File</th><th>Action</th></tr></thead>
    <tbody>
      <tr><td>mi-llavero.3mf</td><td><button>Delete</button></td></tr>
      <tr><td>base.3mf</td><td><button disabled>Delete</button></td></tr>
    </tbody>
  </table>`;

// Build a TableRow directly over one <tr> (Table's finders do this in Task 3).
function rowFor(page: Page, hasText: string): TableRow {
  const locator = page.getByTestId('exports').locator('tbody tr').filter({ hasText }).first();
  return new TableRow(page, { locator }, hasText);
}

test('a row helper button is scoped to that row and narrates the row context', async ({ page }) => {
  await page.setContent(TABLE);
  await rowFor(page, 'mi-llavero.3mf').button('Delete').click(); // enabled → passes

  const [event] = emittedEvents();
  expect(event).toMatchObject({
    status: 'passed',
    sentence: 'Click button "Delete" in row "mi-llavero.3mf"',
  });
});

test('the same helper on another row targets that row (disabled → fails there)', async ({ page }) => {
  await page.setContent(TABLE);
  await expect(rowFor(page, 'base.3mf').button('Delete').click()).rejects.toThrow();
});

test('cell(index) asserts the nth cell text, scoped to the row', async ({ page }) => {
  await page.setContent(TABLE);
  await rowFor(page, 'mi-llavero.3mf').cell(0).expectText('mi-llavero.3mf');

  const [event] = emittedEvents();
  expect(event.status).toBe('passed');
  expect(event.sentence).toContain('in row "mi-llavero.3mf"');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/razo && npx playwright test table-row`
Expected: FAIL — cannot import `TableRow` (module does not exist yet).

- [ ] **Step 3: Implement `packages/razo/src/controls/TableRow.ts`**

```ts
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
    return new Cell(this.page, { css: `td:nth-child(${index + 1})` }, `cell #${index}`, {
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/razo && npx playwright test table-row`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/razo/src/controls/TableRow.ts packages/razo/tests/table-row.spec.ts
git commit -m "Add TableRow + Cell controls with row-scoped helpers"
```

---

### Task 3: `Table<TRow>` finders + exports + integration

**Files:**
- Modify: `packages/razo/src/controls/Table.ts` (generic, `rowClass`, finders)
- Modify: `packages/razo/src/index.ts` (export `TableRow`, `Cell`)
- Modify: `packages/razo/tests/table-row.spec.ts` (add finder + subclass tests)

**Interfaces:**
- Consumes: `TableRow` (Task 2), `Control`, `ControlOptions`, `LocatorSpec`, `StepOptions`.
- Produces:
  - `class Table<TRow extends TableRow = TableRow> extends Control` with `protected rowClass: RowCtor<TRow> = TableRow`, unchanged `expectRowCount`/`expectRowContains`, and finders:
    - `row(textOrIndex: string | number): TRow`
    - `rows(): Promise<TRow[]>`
  - `TableRow`, `Cell` exported from the package root.

- [ ] **Step 1: Write the failing tests** — append to `tests/table-row.spec.ts`

```ts
import { Table } from '../src/controls/Table';
import { Button } from '../src/controls/Button';
import { Label } from '../src/controls/Label';

test('Table.row(text) returns a usable TableRow', async ({ page }) => {
  await page.setContent(TABLE);
  const table = new Table(page, 'exports', 'Exports');
  await table.row('mi-llavero.3mf').button('Delete').click();

  const [event] = emittedEvents();
  expect(event.sentence).toBe('Click button "Delete" in row "mi-llavero.3mf"');
});

test('Table.row(index) targets the 0-based row', async ({ page }) => {
  await page.setContent(TABLE);
  const table = new Table(page, 'exports', 'Exports');
  await table.row(0).cell(0).expectText('mi-llavero.3mf');
  expect(emittedEvents()[0].status).toBe('passed');
});

test('Table.rows() returns all rows', async ({ page }) => {
  await page.setContent(TABLE);
  const rows = await new Table(page, 'exports', 'Exports').rows();
  expect(rows).toHaveLength(2);
  await rows[1].cell(0).expectText('base.3mf');
});

test('a Table<TRow> subclass returns the custom row type', async ({ page }) => {
  class ExportRow extends TableRow {
    delete = new Button(this.page, { role: 'button', name: 'Delete' }, 'Delete', { within: this });
    file = new Label(this.page, { css: 'td:nth-child(1)' }, 'File', { within: this });
  }
  class ExportsTable extends Table<ExportRow> {
    protected rowClass = ExportRow;
  }
  await page.setContent(TABLE);
  const row = new ExportsTable(page, 'exports', 'Exports').row('mi-llavero.3mf');
  await row.file.expectText('mi-llavero.3mf'); // typed field access
  expect(emittedEvents()[0].sentence).toContain('in row "mi-llavero.3mf"');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/razo && npx playwright test table-row`
Expected: FAIL — `Table` has no `row`/`rows`, is not generic.

- [ ] **Step 3: Rewrite `packages/razo/src/controls/Table.ts`**

```ts
import { expect, type Locator, type Page } from '@playwright/test';
import { Control, type ControlOptions, type LocatorSpec, type StepOptions } from './Control';
import { TableRow } from './TableRow';

type RowCtor<TRow extends TableRow> = new (
  page: Page,
  locate: LocatorSpec,
  name: string,
  options?: ControlOptions,
) => TRow;

/** Row assertions plus row access. Subclass with a bound `rowClass` for typed rows. */
export class Table<TRow extends TableRow = TableRow> extends Control {
  protected readonly controlType = 'table';
  protected rowClass: RowCtor<TRow> = TableRow as RowCtor<TRow>;

  private rowsLocator(): Locator {
    return this.locator.locator('tbody tr');
  }

  private makeRow(locator: Locator, name: string): TRow {
    return new this.rowClass(this.page, { locator }, name, {});
  }

  /** A row by cell text, or by 0-based index. */
  row(textOrIndex: string | number): TRow {
    if (typeof textOrIndex === 'number') {
      return this.makeRow(this.rowsLocator().nth(textOrIndex), `row #${textOrIndex}`);
    }
    return this.makeRow(this.rowsLocator().filter({ hasText: textOrIndex }).first(), textOrIndex);
  }

  /** All rows, in DOM order. */
  async rows(): Promise<TRow[]> {
    const count = await this.rowsLocator().count();
    return Array.from({ length: count }, (_, i) =>
      this.makeRow(this.rowsLocator().nth(i), `row #${i}`),
    );
  }

  async expectRowCount(expected: number, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-row-count',
      { ...options, expected: String(expected), readActual: async () => String(await this.rowsLocator().count()) },
      () => expect(this.rowsLocator()).toHaveCount(expected),
    );
  }

  async expectRowContains(expected: string, options: Pick<StepOptions, 'as'> = {}) {
    await this.step(
      'assert-row-contains',
      { ...options, expected, readActual: async () => `${await this.rowsLocator().count()} rows, none matching` },
      () => expect(this.rowsLocator().filter({ hasText: expected }).first()).toBeVisible(),
    );
  }
}
```

- [ ] **Step 4: Export `TableRow` and `Cell`** — add to `packages/razo/src/index.ts` next to the other control exports:

```ts
export { TableRow, Cell } from './controls/TableRow';
```

(The `Table` export already exists — leave it.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/razo && npx playwright test table-row`
Expected: PASS (all table-row tests, including the subclass test).

- [ ] **Step 6: Full suite + typecheck**

Run: `cd packages/razo && npx playwright test` then the package's typecheck (`npm run typecheck` / `tsc --noEmit` if present).
Expected: full suite PASS, types clean. In particular, confirm `expectRowCount`/`expectRowContains` still pass (Table stayed backward-compatible).

- [ ] **Step 7: Commit**

```bash
git add packages/razo/src/controls/Table.ts packages/razo/src/index.ts packages/razo/tests/table-row.spec.ts
git commit -m "Table<TRow>: row finders + rowClass, export TableRow/Cell"
```

---

## Self-review notes

- **Spec coverage:** Task 1 = narration (spec §3); Task 2 = TableRow + Cell + helpers (spec §1); Task 3 = Table<TRow> + finders + exports (spec §2). Out-of-scope `row({column,is})` intentionally absent.
- **Type consistency:** `rowClass: RowCtor<TRow>` matches the `TableRow` constructor `(page, locate, name, options?)`; `makeRow` builds via it; helpers return concrete `Button`/`Link`/`Input`/`Checkbox`/`Cell`; the default `TableRow as RowCtor<TRow>` cast covers the generic default.
- **Backward compatibility:** `Table` gains a generic parameter with a default, so existing `new Table(page, id, name)` calls and the two assertion methods are unchanged.
