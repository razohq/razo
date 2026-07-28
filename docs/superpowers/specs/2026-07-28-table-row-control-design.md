# TableRow control + `Table<TRow>` — design

## Goal

Make the components *inside* a table row (buttons, inputs, links) first-class:
add a `TableRow` control returned by row finders on `Table`, so a control can be
scoped to a specific row natively (`{ within: row }`), the narration says *which*
row acted, and users can declare a typed row class for structured tables.

Today `Table` is read-only (`expectRowCount`, `expectRowContains`) and offers no
way to reach a row's contents. The only workaround is the raw `{ locator }`
escape hatch, which ignores `within`, forces you to hand-label every control to
disambiguate rows, and produces narration that can't tell two rows apart
(`Click button "Delete"` in both). This design removes that gap.

## Background — how scoping already works

`Control`'s constructor takes `(page, locate, name, options)`. When
`options.within` is set, `this.parent` is stored and `resolveLocator(this.healRoot, spec)`
resolves the control's locator *inside the parent's locator* (`healRoot` returns
`parent.locator`). So a `Control` that represents one `<tr>` is all that's needed
for `new Button(page, 'delete', 'Delete', { within: row })` to resolve inside
that row. `TableRow` is exactly that control.

The sentence grammar lives in one `SENTENCES` map in `Control.ts`; `step()` builds
the sentence from `{ controlType, name, detail, expected }`, and the existing `as`
option replaces the whole sentence (business-level narration). We reuse `as` as
the narration opt-out — no new flag.

## 1. `TableRow extends Control`

- `controlType = 'row'`. New file `packages/razo/src/controls/TableRow.ts`.
- Constructed by `Table` (below) with a `{ locator }` spec bound to one row and a
  human **name** that becomes the row's identity in narration. Users never call
  its constructor directly; they get instances from `table.row(...)`.
- Serves as a `within` scope for child controls.
- **Scoped helpers** (the no-subclass path). Each returns a control scoped to the
  row via `{ within: this }`, located **by accessible role + name** (works on any
  markup, unique within a single row):
  - `button(name: string): Button` → `{ role: 'button', name }`
  - `link(name: string): Link` → `{ role: 'link', name }`
  - `input(name: string): Input` → `{ role: 'textbox', name }`
  - `checkbox(name: string): Checkbox` → `{ role: 'checkbox', name }`
  - `cell(index: number): Cell` → the 0-based cell (`td:nth-child(index+1)`), a
    minimal text-assertable control (see Cell below). Its narration name is
    `cell #${index}` (Control requires a non-empty name).
  - `control<C extends Control>(Ctor, locate: LocatorSpec, name: string): C` —
    the generic escape hatch for any control type or any `LocatorSpec` (testid,
    css, role…), also scoped `{ within: this }`.
- **Subclassable** (the structured path). A user declares elements as fields:
  ```ts
  class ExportRow extends TableRow {
    delete = new Button(this.page, 'delete', 'Delete', { within: this });
    status = new Label(this.page, 'status', 'Status', { within: this });
  }
  ```
  Field initializers run after `TableRow`'s constructor has set the row locator,
  so `{ within: this }` resolves correctly.

### Cell (minimal)

`Cell extends Control`, `controlType = 'cell'`, in `TableRow.ts`. Located by the
row's nth `<td>`. Methods: `expectText(expected)` and `expectContainsText(expected)`
(reuse the existing `assert-text` / `assert-contains-text` actions). Just enough
to assert a cell's value; not a general interactive control.

## 2. `Table<TRow extends TableRow = TableRow>`

`Table.ts` becomes generic. Existing `expectRowCount` / `expectRowContains` are
unchanged.

- `protected rowClass: new (page, locate, name, options?) => TRow = TableRow` — a
  `Table` subclass overrides it to bind a custom row class:
  ```ts
  class ExportsTable extends Table<ExportRow> {
    protected rowClass = ExportRow;
  }
  ```
- Private `rows()` locator stays (`this.locator.locator('tbody tr')`).
- **Finders** (all build a `TRow` via `this.rowClass`, scoped with a `{ locator }`
  spec pointing at the chosen row):
  - `row(text: string): TRow` — the row whose text contains `text`
    (`this.rowsLocator().filter({ hasText: text }).first()`); identity name = `text`.
  - `row(index: number): TRow` — the 0-based row (`this.rowsLocator().nth(index)`);
    identity name = `row #${index}`.
    (One overloaded `row(textOrIndex: string | number)`.)
  - `rows(): Promise<TRow[]>` — all rows. Async because it reads the live count,
    then builds one `TRow` per index (name `row #${i}`), for iterating / `.length`
    / `.map`.
- Finders are **lazy**: `row(...)` returns a `TRow` immediately and the locator
  resolves when you act or assert on it or a child — consistent with the rest of
  razo. Only `rows()` is async (it needs the count up front).

## 3. Narration — auto within-context (`Control.step()`)

When a control has a `within` parent, append ` in <parentType> "<parentName>"` to
the generated grammar sentence:

```
Click button "Delete" in row "mi-llavero.3mf"
Assert label "Status" has text "Exported" in row "mi-llavero.3mf"
```

- The clause is appended to the sentence built from `SENTENCES`; the structured
  StepEvent fields are unchanged. Immediate parent only (no full chain).
- **Opt-out / override:** the existing `as` option replaces the whole sentence, so
  `{ within: row, as: 'Remove the selected export' }` yields exactly
  `Remove the selected export` with no auto-context. No new option is introduced.
- This applies to **all** `within` parents, not just rows — so `within: dialog`,
  `within: card`, etc. also gain context. Blast radius on the current codebase is
  tiny: no `within` usage in `src/`, and two test files
  (`tests/healing.spec.ts`, `tests/locators.spec.ts`) whose sentence assertions
  must be updated to include the new clause.

## Examples

No subclass (helpers):
```ts
const row = table.row('mi-llavero.3mf');
await row.button('Delete').click();          // Click button "Delete" in row "mi-llavero.3mf"
await row.cell(1).expectText('Exported');
```

Subclass (structured + typed):
```ts
class ExportRow extends TableRow {
  delete = new Button(this.page, 'delete', 'Delete', { within: this });
  status = new Label(this.page, 'status', 'Status', { within: this });
}
class ExportsTable extends Table<ExportRow> {
  protected rowClass = ExportRow;
}
const row = new ExportsTable(page, 'exports', 'Exports').row('mi-llavero.3mf');
await row.delete.click();
await row.status.expectText('Exported');
```

## Testing

Reuse the existing harness: `page.setContent(<table>)`, act via the controls,
read emitted `StepEvent`s from `test.info().attachments` (the `emittedEvents()`
pattern in `control-base.spec.ts`), and assert `sentence` / `status` / `actual`.

- `Table` finders: `row(text)`, `row(index)`, `rows()` resolve the right `<tr>`.
- Helper scoping: `row('A').button('Delete')` clicks the Delete in row A, not row B
  (two rows sharing markup), and a disabled/hidden target fails as expected.
- Narration: a child of a row emits `... in row "A"`; `as` overrides it entirely.
- `Control.step()` within-context unit: a generic probe control within a parent
  gets the appended clause (extend `control-base.spec.ts`).
- Subclass path: a custom `TableRow` subclass with field controls resolves and
  narrates correctly; a `Table<TRow>` subclass returns the custom type.
- `Cell.expectText` passes/fails with correct `expected`/`actual`.
- Update the two existing `within` sentence assertions.

## Files

- Create `packages/razo/src/controls/TableRow.ts` (`TableRow` + `Cell`).
- Modify `packages/razo/src/controls/Table.ts` (generic, `rowClass`, finders).
- Modify `packages/razo/src/controls/Control.ts` (append `within` clause in `step()`).
- Modify `packages/razo/src/index.ts` (export `TableRow`, `Cell`).
- Modify `tests/healing.spec.ts`, `tests/locators.spec.ts` (update `within` sentence asserts).
- Add `tests/table-row.spec.ts` (new coverage).

## Out of scope (follow-up)

- `row({ column, is })` — find by column + value (parse `<thead>`, handle colspans).
- Making `Table` interactive beyond row access (it stays assertions + row finders).
- Row-level assertions on `TableRow` itself beyond cell text (e.g. `row.expectSelected()`).
