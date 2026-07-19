# razo-analyzer

**AI failure analysis for [razo](https://www.npmjs.com/package/@razohq/razo) test artifacts.** Feeds failed tests' `razo-steps.json` to Claude and returns, in business terms: which action failed, a root-cause hypothesis (app bug, outdated expectation, missing precondition, flake), and a suggested fix.

Because razo narrates every action and assertion structurally (sentence, control name, expected vs actual), the model doesn't guess from stack traces — it reads the story.

## CLI

```bash
npm install -D @razohq/razo-analyzer
export ANTHROPIC_API_KEY=sk-ant-...

npx razo-analyze                     # scans test-results/ for razo-steps.json
npx razo-analyze path/to/razo-steps.json --out analysis.md
npx razo-analyze --dry-run           # print the prompt without calling the API
```

In a GitHub Actions PR context, `--pr-comment` posts (or updates) the analysis as a PR comment.

## Command reference

The package ships two binaries. Both accept `-h`/`--help`.

### `razo-analyze [target] [options]`

Analyzes the failed tests found in razo `razo-steps.json` artifacts with Claude
and prints a business-level failure analysis in Markdown to stdout.

| Argument / option | Default | Meaning |
|---|---|---|
| `target` | `test-results` | An `razo-steps.json` file or a directory to scan recursively |
| `--out <file>` | — | Also write the analysis to a file |
| `--pr-comment` | off | Post/update the analysis as a PR comment (GitHub Actions context) |
| `--provider <name>` | `anthropic` | Model provider: `anthropic` or `openai` |
| `--model <id>` | `claude-opus-4-8` (anthropic) | Model id; **required** with `--provider openai` (no default is assumed) |
| `--dry-run` | off | Print the prompt(s) instead of calling the API |

| Environment variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Credentials for the default anthropic provider (or log in once with `ant auth login`) |
| `OPENAI_API_KEY` | Credentials when using `--provider openai` |
| `RAZO_ANALYZE_BUDGET` | Prompt budget in characters (default `200000`); large suites split into one API call per batch |
| `GITHUB_TOKEN` + PR context | Required by `--pr-comment` |

Exit codes: `0` success (also when there is nothing to analyze), `1` API
error, `2` usage error.

### `razo-upload [target] [options]`

Uploads `razo-steps.json` artifacts to a razo dashboard. Payloads are trimmed
to the server's ingest limits before sending (see Size limits below) — an
upload never fails because of size.

| Argument / option | Default | Meaning |
|---|---|---|
| `target` | `test-results` | An `razo-steps.json` file or a directory to scan recursively |
| `--url <ingest-url>` | `$RAZO_INGEST_URL` | The dashboard ingest endpoint, e.g. `https://razo.ar/api/ingest` |
| `--token <rz_...>` | `$RAZO_INGEST_TOKEN` | The project's ingest token (dashboard → project → Settings) |

| Environment variable | Meaning |
|---|---|
| `RAZO_INGEST_URL` | Default for `--url` |
| `RAZO_INGEST_TOKEN` | Default for `--token` |
| `GITHUB_*` (Actions) | Branch, commit, PR number and CI link are read automatically and attached to the run |

Exit codes: `0` success (also when there is nothing to upload), `1` upload
failed, `2` usage error.

## GitHub Action

```yaml
- name: Run Playwright tests
  run: npx playwright test

- name: AI failure analysis
  if: failure()
  uses: razohq/razo/packages/razo-analyzer@main
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    results-dir: test-results
```

## Example output

Against razo's demo failure (an export attempted without ever choosing a quality):

> **What failed:** the final verification `Assert label "Export status" has text "Exported mi-llavero.3mf (Standard)"` — the app answered `"Error: missing fields"` instead.
>
> **Root cause:** missing test precondition. The narration shows the filename was typed and the format chosen, but **no step ever selected a quality** before `Click button "Export"` — the app correctly rejected the export.
>
> **Fix:** add `quality.select('Standard')` before the export, or if quality became optional, update the expected status text.

## Cost

Each analysis is a single Claude call (model: `claude-opus-4-8`, ~$5/M input, $25/M output tokens). A typical failed-test analysis uses a few thousand tokens — around $0.05–0.15 per run. Use `--model` to override.

## Size limits

Both CLIs are safe on pathological suites, and never trim silently:

- **`razo-analyze`** budgets its prompts (default 200k characters ≈ 50k
  tokens, override with `RAZO_ANALYZE_BUDGET`). Large suites split into
  batches — one API call each, analyses concatenated in order. A single
  huge test gets its middle passed steps collapsed into a
  "… N steps omitted …" marker; failed steps are never dropped.
- **`razo-upload`** truncates to the dashboard's ingest limits before
  sending (error text 20k chars, 500 steps/test, 2MB payload, 200 reports)
  instead of letting the server reject the whole run. Failed reports are
  always kept; oversized passed reports are dropped first and the CLI says
  so. The `razo-steps.json` files on disk are never modified.

## API

```ts
import { loadFailedReports, analyzeFailures, buildPrompt } from '@razohq/razo-analyzer';

const failed = loadFailedReports('test-results');
const markdown = await analyzeFailures(failed);
```

## License

MIT
