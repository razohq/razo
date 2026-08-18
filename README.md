# razo

**Did the app break, or did the tests go stale?** razo answers that on the pull request.

This is what the bot posted on [razohq/razo-demo#1](https://github.com/razohq/razo-demo/pull/1), a public PR that changes a checkout flow and breaks two of its own tests:

> ### razo — 2 failed · 2 passed · `02b1f81`
>
> **Intentional change** — PR intentionally hides the Place order button and removes the Mouse row; both failing tests assert the old UI.
>
> - `placing the order confirms it` — tests/checkout.spec.ts
>   ↳ touched button "Place order", which this PR changed in `tests/checkout-page.ts`
> - `the cart lists both items` — tests/checkout.spec.ts
>
> **Next:** Update or skip these two tests until the express-checkout summary (follow-up PR) lands, per the stated plan.

**[Read it on the pull request →](https://github.com/razohq/razo-demo/pull/1#issuecomment-5162044806)** — public, no account needed.

That second line is the part no other tool can write. razo knows `placing the order confirms it` clicked a control named **Place order**, because you named it; it reads what the PR changed; and it says so. Nothing else can join those two, because nothing else records which control a test drove — only which line threw.

Blank that PR's description and the verdict becomes `Undetermined`, naming what the diff did and asking the author whether it was deliberate. A diff says what changed and never whether it was meant, so razo will not guess.

## What's in the repo

Every action and assertion produces two outputs at once: a human sentence in the Playwright report (`Click button "Export"`) and a structured `StepEvent` in `test-results/<test>/razo-steps.json`. The sentence is what makes a failure readable; the record is what makes the verdict above possible.

| Package | What it is |
|---|---|
| [`@razohq/razo`](packages/razo) | The framework: 20 controls, narrated assertions, deterministic self-healing locators, the `@razohq/razo/reporter` that writes `razo-steps.json` per test, and the `@razohq/razo/vite` auto-testid plugin. Zero runtime dependencies. |
| [`@razohq/razo-analyzer`](packages/razo-analyzer) | CLIs + GitHub Action: `razo-analyze` feeds failed tests to an AI model and returns a business-level verdict; `razo-upload` ships artifacts to a [razo dashboard](https://razo.ar). |

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
