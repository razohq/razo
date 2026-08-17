# razo

**Playwright controls that narrate every action — and emit a structured artifact your AI can actually read.**

Every action and assertion in razo produces two outputs at once: a human sentence in the Playwright report (`Click button "Export"`) and a structured `StepEvent` written to `test-results/<test>/razo-steps.json`. When a test fails, the artifact tells the whole story — what the test was doing, what it expected, and what the page actually said.

| Package | What it is |
|---|---|
| [`@razohq/razo`](packages/razo) | The framework: 20 controls, narrated assertions, deterministic self-healing locators, the `@razohq/razo/reporter` that writes `razo-steps.json` per test, and the `@razohq/razo/vite` auto-testid plugin. Zero runtime dependencies. |
| [`@razohq/razo-analyzer`](packages/razo-analyzer) | CLIs + GitHub Action: `razo-analyze` feeds failed tests to an AI model and returns a business-level verdict; `razo-upload` ships artifacts to a [razo dashboard](https://razo.ar). |

## See it without installing anything

[**razohq/razo-demo#1**](https://github.com/razohq/razo-demo/pull/1) is a live pull request that changes a checkout flow and breaks two of its own tests. CI runs the suite, uploads the artifacts, and the razo bot [comments on the PR](https://github.com/razohq/razo-demo/pull/1#issuecomment-5162044806) — public, no account needed to read it.

The comment is a headline, not a report — one verdict, the tests it covers, and a link out:

```markdown
### razo — 2 failed · 2 passed

**One-line verdict on what these failures mean for this PR.**

- `the cart lists both items` — tests/checkout.spec.ts
- `placing the order confirms it` — tests/checkout.spec.ts

[See the full analysis on razo →](https://razo.ar/dashboard/…)
```

The narrated steps behind that verdict — every control each test touched, what it expected, what the DOM actually said — are what the model reads. To see them for your own suite, run the [quickstart](#quickstart) below; the dashboard run linked from the comment needs a razo account.

## Quickstart

```bash
npm i -D @razohq/razo
```

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['html'], ['@razohq/razo/reporter']],
});
```

```ts
import { Button, Input, Label } from '@razohq/razo';

test('export a model', async ({ page }) => {
  await new Input(page, 'filename', 'Filename').fill('mi-llavero');
  await new Button(page, 'export', 'Export').click();
  await new Label(page, 'status', 'Export status').expectText('Exported mi-llavero.3mf');
});
```

Docs: [razo.ar/docs](https://razo.ar/docs)

## Contributing

PRs welcome. `npm ci && npm test` runs everything (typecheck, builds, package checks, the Playwright suites and a tarball consumption smoke test).

Releases flow through [changesets](https://github.com/changesets/changesets): add a changeset with your PR and CI publishes on merge.

## License

[MIT](LICENSE)
