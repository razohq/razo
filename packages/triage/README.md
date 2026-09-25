# @razohq/triage

Morning triage for Playwright runs narrated by razo. Reads the `razo-steps.json`
artifacts of recent CI runs, clusters the failures by cause, classifies each
cluster (regression, flaky, environment, stale-test, unknown), names the
suspect commits, and writes a Markdown report.

Private package: not published yet.

## Setup

```bash
npm i                                   # from the repo root; the package is a workspace
npm run build -w @razohq/triage
```

## Token

`triage pull` and the `github` code adapter use a GitHub token with two
read permissions on the repository:

- **Actions: read**, to list workflow runs and to list and download artifacts.
- **Contents: read**, to compare commits and read their diffs.

A fine-grained personal access token scoped to the repository with exactly
those two permissions is enough. Put it in the environment (`GITHUB_TOKEN`)
and reference it from the config as `${GITHUB_TOKEN}`; the config file never
holds the token itself, and an unset variable is an error rather than an
empty token.

The CI workflow has to upload `test-results/` on every run, green ones
included, under a name that starts with the artifact prefix (default
`razo-test-results-`). razo-demo's `e2e.yml` does that with `if: always()`,
a name built from `run_id` and `run_attempt`, and `retention-days: 30`.

## Config

`triage.config.yaml`:

```yaml
baseBranch: main
source:
  plugin: razo-source
  config: { dataDir: ./.razo }
pull:
  repo: razohq/razo-demo
  token: ${GITHUB_TOKEN}
  workflow: e2e.yml        # optional: one workflow file, else every workflow
  branch: main             # optional
  artifactPrefix: razo-test-results-   # optional, this is the default
code:
  plugin: github
  config: { repo: razohq/razo-demo, token: ${GITHUB_TOKEN} }
notifiers:
  - plugin: markdown
    config: { outDir: ./triage-reports }
rules:                     # optional; DESIGN.md §6 defaults, flaky and environment thresholds still provisional
  env: { windowMinutes: 10, minFiles: 5 }
  flaky: { lookbackRuns: 10, quarantineSuggestAfter: 3 }
  regression: { stableRuns: 3 }
```

Offline: `code: { plugin: commits-json, config: { path: ./commits.json } }`
reads a commits list shaped like the ones under `fixtures/`.

## Commands

```bash
npx triage pull --since 7d                       # materialize CI runs into ./.razo
npx triage run  --since 24h --lookback 14d       # triage the last day with two weeks of history
```

`run` writes `triage-<timestamp>.md` plus its `.json` twin to `outDir` and
prints one line per cluster. `--now <iso>` replays a past morning: runs
finished after it are left out. Exit codes: 0 on a report (failures or
not), 1 on a broken setup, 2 on a usage error.

## Development

```bash
npm test -w @razohq/triage              # builds, then node --test
node scripts/capture-razo-demo.mjs      # regenerate the razo-demo fixture
node fixtures/generator/generate.mjs    # regenerate the synthetic fixtures
```
