# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What razo is

razo answers "did the app break, or did the tests go stale?" on a pull request. Every action or assertion a test performs produces two outputs at once: a human sentence in the Playwright report (`Click button "Export"`) and a structured `StepEvent` written to `test-results/<test>/razo-steps.json`. The analyzer feeds those artifacts to an LLM and posts a business-level verdict on the PR.

npm workspaces monorepo, Node >= 20, TypeScript, built with tsup, released with changesets.

| Package | npm name | Role |
|---|---|---|
| `packages/razo` | `@razohq/razo` | The framework: the control classes (one per UI widget), narrated assertions, deterministic self-healing locators, the `/reporter` entry that writes `razo-steps.json`, the `/vite` auto-testid plugin. Zero runtime deps. |
| `packages/razo-analyzer` | `@razohq/razo-analyzer` | `razo-analyze` CLI (+ GitHub Action via `action.yml`) and `razo-upload` CLI. Depends on `@anthropic-ai/sdk` and `openai`. |
| `packages/triage` | `@razohq/triage` | Morning triage, private until its Phase 5. Phase 1 is done: canonical model, the four ports, the plugin type, a runner-agnostic contract test kit (`/contract` entry) and in-memory fakes (`/fakes` entry). Design in `DESIGN.md` (Spanish). |

## Commands

From the repo root (`npm ci` first):

```bash
npm run typecheck          # tsc --noEmit in every workspace
npm run build              # tsup in every workspace
npm test                   # every workspace's test script
./scripts/smoke-tarball.sh # pack @razohq/razo, install the tarball in a temp project, run a real test against it
npm run check:package -w @razohq/razo   # publint + arethetypeswrong
```

CI (`.github/workflows/ci.yml`) runs exactly that sequence: typecheck, build, package checks, `playwright install chromium`, `npm test`, smoke tarball.

### `packages/razo` (Playwright suite)

```bash
cd packages/razo
npx playwright test                       # whole suite (needs chromium installed once: npx playwright install chromium)
npx playwright test tests/healing.spec.ts # one file
npx playwright test -g "stale testid"     # one test by title substring
npm run build:demo                        # vite build of demo-app/ (exercises the autoTestId plugin)
```

Tests import from `../src` directly. The Playwright config registers `./src/reporting/AiReporter.ts` as a reporter, so a full run writes `razo-steps.json` under `test-results/`. `expect.timeout` (3s) and `actionTimeout` (5s) are deliberately below the test timeout so a hanging action fails inside its step and still emits a `failed` StepEvent.

### `packages/razo-analyzer` (node:test)

```bash
cd packages/razo-analyzer
npm test                                  # builds first, then node --test test/*.test.mjs
node --test test/limits.test.mjs          # one file (run npm run build first: tests import ../dist/index.js)
npx razo-analyze --dry-run                # print the prompt without calling any API
```

The analyzer tests run against `dist/`, not `src/`. If a test looks stale after a source edit, rebuild.

### `packages/triage` (node:test)

```bash
cd packages/triage
npm test                                  # builds first, then node --test test/*.test.mjs
node --test test/contract.test.mjs        # after npm run build; tests import ../dist/*.js
```

## Architecture

### The narration core: `Control.step()` (`packages/razo/src/controls/Control.ts`)

Everything flows through one protected method. `step(action, options, fn)`:

1. Builds the sentence from the `SENTENCES` grammar table (one fixed template per verb, all in this file). A `within` parent appends `in dialog "Confirm export"`; `options.as` overrides the whole sentence for business-level narration.
2. Runs `fn` inside `test.step(sentence, ...)`.
3. Emits a `StepEvent` (passed or failed) via `emitStepEvent`, which pushes a JSON attachment named `ai-step` onto `test.info()`. Attachments are how events cross the worker → reporter boundary without shared state.
4. On failure, if the primary locator resolves to zero elements, tries healing (below). An element that exists but fails the action or assertion is never healed.

Adding a verb means adding a template to `SENTENCES` (its key becomes a `StepAction`) and calling `this.step` from a control method. Adding a control means subclassing `Control`, declaring `controlType`, and exporting it from `src/index.ts`. Assertions pass `readActual` so a failed step records what the DOM actually had.

### Locating and healing

`LocatorSpec` is a string (data-testid) or an object mapping 1:1 to a Playwright `getBy*` locator, plus `{ locator }` as escape hatch. `describeSelector` produces the readable selector string that travels in every StepEvent; `within` parents prefix it.

Healing is deterministic: explicit `fallbacks` in order, then an implicit `{ role, name, exact: true }` derived from `IMPLICIT_ROLE[controlType]`. A fallback only wins if it resolves to exactly one element. Control types with ambiguous roles (label, tooltip, editor, file input, cell, row) are deliberately absent from `IMPLICIT_ROLE` and heal only through explicit fallbacks. `RAZO_HEALING` env: `pass` (default, heal and record `healed: {from, to}`), `fail` (throw a "locator drift" error naming the working locator), `off`. When nothing heals, `domCandidates` lists up to 5 same-role elements so the analyzer can propose a replacement locator.

### Reporter (`src/reporting/AiReporter.ts`)

Collects the `ai-step` attachments in `onTestEnd` and writes `<outputDir>/<file-slug>-<title-slug>[-retryN]/razo-steps.json` as an `AiTestReport`. `outputDir` is resolved relative to the Playwright config file, not `rootDir`. The package's default export must stay a class so `reporter: [['@razohq/razo/reporter']]` works from both CJS and ESM; the tarball smoke test is the only check that catches that interop regressing.

### Auto testid (`src/tooling/autoTestId.ts`)

`data-component="ExportButton"` becomes `data-testid="export-button"` via `toTestId` (kebab-case of the component name). A manual `data-testid` always wins. The plugin only implements `transformIndexHtml` and is typed structurally so vite stays an optional peer.

### Analyzer pipeline (`packages/razo-analyzer/src`)

`reports.ts` finds every `razo-steps.json` (legacy `ai-steps.json` accepted) and keeps non-passed, non-skipped ones → `prompt.ts` renders each report as Markdown, greedily packs them into batches under `promptBudget()` chars (`RAZO_ANALYZE_BUDGET` overrides, default 200k) → `analyze.ts` sends each batch to Anthropic (default model in code) or OpenAI (`--model` required, no default on purpose) → `github.ts` upserts a PR comment keyed on an HTML marker so re-runs replace instead of stack.

`types.ts` mirrors razo's `StepEvent` / `AiTestReport` on purpose so the analyzer has no runtime dependency on razo. Change one, change the other.

`limits.ts` holds the size caps of the hosted ingest (a private app, not in this repo). `razo-upload` must truncate below them because the server rejects oversized payloads whole. `trimStepsTo` always keeps failed steps, then first/last passed ones, and inserts a synthetic `omitted` marker step. The same trimmer serves the prompt budget.

API clients are injectable (`client`, `openaiClient` options) so tests use fakes and never hit the network.

### Triage contracts (`packages/triage/src`)

`core/model.ts` is DESIGN.md §5 verbatim plus `ChangedFile`. `core/signature.ts` owns `errorSignature` and `clusterIdOf`: adapters never normalize errors themselves, and the ResultSource kit asserts every `TestError.signature` equals `errorSignature(message)`.

Each kit in `contract/` is a function from an adapter factory to a list of runner-agnostic `ContractCase`s asserting with `node:assert`; `runContract(cases, test)` registers them with node:test, vitest or jest. Factories receive `contract/seed.ts` data and return an adapter preloaded with it, so the same kit runs against an in-memory fake or a real adapter that writes the seed to disk. `test/contract.test.mjs` also proves each kit catches a deliberately broken adapter. Deviations from DESIGN.md: `CodeContext.changedFiles` returns `ChangedFile[]` with patches, not filenames; `TriagePlugin.configSchema` is structural (`{ parse }`, zod-compatible) so the core has no zod dependency.

Phase 2a adds `adapters/razo-source`, a pure reader of `<dataDir>/runs/<runId>/{run.json,reports/**/razo-steps.json}` (retry index from the report's `retry` field, else the `-retryN` directory name), and the deterministic core in dependency order: `cluster` groups failed attempts by signature, `history` computes per-test outcome sequences on the base branch (`baseBranch`, default `main`), `suspects` matches control needles against commit patches and flags unevaluable files, `classify` applies DESIGN.md §6 per test and resolves mixed clusters by unanimity or majority. `analyzeWindow` in `core/pipeline.ts` chains them. Tests run against `fixtures/` (see its README): regenerate with the scripts in `packages/triage/scripts`, never edit a report by hand; `fixtures/generator` is a Playwright project that produces the two synthetic scenarios, marked `synthetic: true` in `run.json`.

Phase 2b adds the network edge: `adapters/github` over one `GitHubApi` with an injectable `fetch` (tests replay canned responses, nothing touches the network), `collectors/github-artifacts` behind `triage pull`, the offline `commits-json` code adapter, the Markdown notifier (writes `.md` and `.json`; `readReports` reads them back for the contract kit), YAML config with `${VAR}` expansion and a plugin registry in `config/`, and the CLI: `src/cli.ts` only parses argv, `src/commands.ts` holds `runTriage` and `runPull` so tests drive them without spawning. Config shape and token permissions are in `packages/triage/README.md`. When chaining test runs in a shell, gate on the exit code of `node --test`, not on `grep` output.

Phase 3 adds memory: the `TriageStore` port (`ports/store.ts`, kit in `contract/store.ts`), the `json-file` adapter (`adapters/json-store`, atomic writes, `schemaVersion`, signature algorithm version), `core/state.ts` (`reconcileClusters`: previous state, novelty, resolution), and CI persistence through the `razo-triage-state` artifact (`collectors/state-artifact.ts`, restored by `triage pull` from base-branch runs only; the workflow uploads it). When `errorSignature` changes what it collapses, bump `SIGNATURE_ALGORITHM_VERSION`.

## Conventions

- Contributions need a changeset (`npx changeset`) with the PR. The release workflow publishes on merge to `main`.
- `.changeset/config.json` says `access: restricted` but each package's `publishConfig.access` is `public`; the package setting wins at publish time.
- `docs/superpowers/` and `.superpowers/` are local planning notes and are gitignored. Do not reference them from shipped code or READMEs.
- README examples in `packages/razo/README.md` and the root README are the public contract for sentences and the `StepEvent` shape. Update them when the grammar or the JSON changes.

## Morning triage (`packages/triage`)

Before working in this package, read `packages/triage/DESIGN.md`. It is the source of truth for the design.

### Rules that never break

- `src/core/` imports only from `src/core/` and `src/ports/`. It never imports adapters, external services or razo internals.
- Access to razo data goes exclusively through the `ResultSource` interface (adapter `src/adapters/razo-source/`).
- Grouping, classifying and finding suspect commits is deterministic. This package calls no model: assisted diagnosis, trackers and interactive notifications live in razo-cloud and consume `TriageItem[]` without changing what the rules decided with `high` confidence.
- This package only reads external systems. It never writes to a tracker or a chat.
- Secrets come from environment variables. They are never hardcoded or logged.

### Way of working

- Tests first for classification rules, clustering and suspect commits, using the real Playwright fixtures under `packages/triage/fixtures/`.
- Unit tests never touch the network. Integrations are tested with the contract kit, fake adapters and an injected `fetch` that replays recorded responses.
- Every new adapter must pass the contract test kit of its kind, exported from `@razohq/triage/contract`.
- Rule thresholds live in the config, never as magic numbers in the code.
- Work one phase of `DESIGN.md` at a time. When a phase ends, update `DESIGN.md` with the decisions taken and mark the phase complete.
- Everything that gets pushed is in English: code, comments, tests, docs and commit messages.
