# razo

**Playwright UI controls that narrate every action twice: a readable sentence in the report, and a structured JSON artifact built for AI failure analysis.**

Page objects have existed for years. razo turns every test into a structured narration — actions and assertions with human names — designed so an AI can analyze failures without guessing. **The output is the product, not the wrapper.**

When a test fails, you don't get a bare `locator timed out`. You get *which business action* failed and *what was expected*, both as a readable story in the Playwright HTML report and as machine-readable JSON:

```json
{
  "test": "export a model without choosing quality",
  "status": "failed",
  "steps": [
    { "action": "fill",   "controlType": "field",  "name": "Filename", "detail": "mi-llavero", "status": "passed" },
    { "action": "choose", "controlType": "select", "name": "Format",   "detail": "3MF",        "status": "passed" },
    { "action": "click",  "controlType": "button", "name": "Export",   "status": "passed" },
    { "action": "assert-text", "controlType": "label", "name": "Export status",
      "expected": "Exported mi-llavero.3mf (Standard)", "actual": "Error: missing fields",
      "status": "failed", "error": "expect(locator).toHaveText(expected) failed ..." }
  ]
}
```

A model reading this can answer: *"the export never happened — a filename was typed and a format chosen, but nobody selected the quality, and the app responded 'Error: missing fields'"*.

## Install

```bash
npm install -D @razohq/razo @playwright/test
```

## Quickstart

Every control takes a `data-testid` and a **human name**. Every method emits a `test.step()` sentence plus a structured `StepEvent`:

```ts
import { Button, Input, Select, Label } from '@razohq/razo';

const filename = new Input(page, 'filename', 'Filename');
const format = new Select(page, 'format', 'Format');
const exportBtn = new Button(page, 'export', 'Export');
const status = new Label(page, 'status', 'Export status');

await filename.fill('mi-llavero');        // Type "mi-llavero" into field "Filename"
await format.choose('3MF');               // Choose "3MF" in select "Format"
await exportBtn.click({ as: 'Confirm the export' }); // business-level override
await status.expectText('Exported mi-llavero.3mf (Standard)');
```

Controls: `Button`, `Input`, `TextArea`, `RadioButton`, `Checkbox`, `Select` (single and `chooseMany` for multiple), `Slider`, `FileInput`, `Link`, `Label` (assertions only), `Switch`, `Combobox`, `Table`, `Dialog`, `Tabs`, `Image`, `DatePicker`, `Menu`, `Tooltip` (via `aria-describedby`), and `Editor` (contenteditable). Every control requires a name — an anonymous control breaks the narration, so the constructor rejects it.

Controls can be scoped inside another control with `{ within }` — the narration stays business-level while the `StepEvent` selector carries the full chain:

```ts
const dialog = new Dialog(page, 'confirm-dialog', 'Confirm export');
const yes = new Button(page, 'confirm-yes', 'Yes, export', { within: dialog });
// StepEvent selector: [data-testid="confirm-dialog"] [data-testid="confirm-yes"]
```

Universal interactions on every control: `hover`, `doubleClick`, `rightClick`, `press(key)`, `focus`, `scrollTo`, and `dragTo(target)` — each with its own grammar sentence (`Hover over button "Export"`, `Drag file input "Model" onto button "Upload zone"`).

Narrated assertions on every control: `expectVisible`, `expectHidden`, `expectEnabled`, `expectDisabled`, `expectFocused`, `expectText`, `expectContainsText`, `expectAttribute`, `expectCount` (for repeated testids) — plus control-specific ones (`Checkbox.expectChecked`, `RadioButton.expectSelected`, `Slider.expectValue`, `FileInput.expectFile`, `Link.expectHref`, `Input.expectEmpty`, `Switch.expectOn/expectOff`, `Table.expectRowCount/expectRowContains`, `Dialog.expectOpen/expectClosed`, `Tabs.expectActive`, `Image.expectAlt/expectLoaded`, `DatePicker.expectDate`, `Combobox.expectSelected`). On failure the event includes `expected` and the `actual` value read from the DOM.

## Locating controls

A plain string means `data-testid` — the recommended, stable path (pair it with the auto-testid Vite plugin below). But razo also accepts Playwright's user-facing locators, so it works on apps that were never instrumented:

```ts
new Button(page, 'export', 'Export');                                  // data-testid
new Button(page, { role: 'button', name: 'Export', exact: true }, 'Export');
new Input(page, { label: 'Filename' }, 'Filename');
new Input(page, { placeholder: 'my-app e2e' }, 'Project name');
new Button(page, { text: 'Upload to cloud' }, 'Upload to cloud');
new Image(page, { altText: 'Model preview' }, 'Model preview');
new Label(page, { css: '#status' }, 'Export status');
new Button(page, { locator: page.getByTestId('export').first() }, 'Export'); // escape hatch
```

The narration never depends on the strategy — only the `StepEvent.selector` changes, and it stays readable (`role=button[name="Export"]`, `label="Filename"`, `css=#status`). Note: a raw `{ locator }` is already bound to the page, so it ignores `{ within }` scoping.

## The AI artifact: wiring the reporter

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['html'], ['@razohq/razo/reporter']],
  // recommended: action/assertion timeouts below the test timeout, so a hanging
  // action fails inside its step (emitting its StepEvent) instead of killing
  // the test with no narration
  expect: { timeout: 3_000 },
  use: { actionTimeout: 5_000 },
});
```

The reporter writes one `test-results/<test>/razo-steps.json` per test (configurable via `[['@razohq/razo/reporter', { outputDir: '...' }]]`).

### The `StepEvent` contract

Each step in `razo-steps.json` is a `StepEvent` — the artifact contract AI tooling can build on:

| Field | Meaning |
|---|---|
| `action` | Grammar verb: `click`, `fill`, `choose`, `attach`, `set`, `assert-text`, ... |
| `controlType` | `button`, `field`, `select`, `slider`, `radio group`, ... |
| `name` | The control's human name (`"Export"`, `"Filename"`) |
| `sentence` | The sentence exactly as shown in the Playwright report |
| `detail` | Action payload (typed text, chosen option, attached file) |
| `expected` | Assertions: what was expected |
| `actual` | Failed assertions: what was actually found in the DOM |
| `selector` | Stable selector (`[data-testid="..."]`) |
| `status` | `passed` \| `failed` |
| `error` | Error message (ANSI-free) when failed |
| `timestamp` | ISO 8601 |

The sentence grammar lives in one place — fixed templates per verb — so the narration is predictable and parseable.

## Auto `data-testid` (Vite plugin)

The other half: a stable hook with zero maintenance. A component declares who it is and the plugin generates the testid in dev/test:

```html
<button data-component="SaveButton">Save</button>
<!-- becomes -->
<button data-component="SaveButton" data-testid="save-button">Save</button>
```

**Alignment rule:** `data-testid` = kebab-case of the component name (`NewsletterOptIn` → `newsletter-opt-in`). A manual `data-testid` always wins.

```ts
// vite.config.ts — register only in dev/test if you don't want it in production
import { autoTestId, toTestId } from '@razohq/razo/vite';
export default defineConfig({ plugins: [autoTestId()] });

// consuming it from a test
new Button(page, toTestId('SaveButton'), 'Save'); // getByTestId('save-button')
```

`vite` is an optional peer dependency — if you don't use the plugin, you don't need it.

## Self-healing locators

Deterministic by design: no AI runs inside your tests. Because every control
already declares a type and a human name, razo can recover from locator drift
without guessing:

- When a control's primary locator stops resolving, razo tries the control's
  explicit `fallbacks` (in order), then the implicit `role + accessible name`
  derived from its type and name. The first spec matching exactly one element
  wins.

```ts
new Button(page, 'export-v1', 'Export', {
  fallbacks: [{ text: 'Export' }], // optional; tried before role=button[name="Export"]
});
```

- A healed step passes and its StepEvent carries
  `healed: { from, to }` — CI stays green, the drift stays visible in the
  report and the artifact.
- `RAZO_HEALING=fail` turns healing into a diagnosis: the step fails with a
  "locator drift" error naming the working locator. `RAZO_HEALING=off`
  disables it.
- Healing only triggers when the element cannot be found at all. An element
  that exists but fails an action or assertion fails normally — healing never
  masks a product regression.
- When nothing heals, the failed StepEvent includes `domCandidates` (same-role
  elements on the page) so `razo-analyze` can propose the corrected locator.

## Notes

- razo runs inside Playwright's Node workers only (not component-testing browser context).
- Loading the CJS entry in your config and the ESM entry in specs is safe: events travel as Playwright attachments, so there is no shared module state.

## License

MIT
