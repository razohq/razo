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
  config: { repo: razohq/razo-demo, token: "${GITHUB_TOKEN}" }   # quoted: inside { } a bare ${ } is not YAML
notifiers:
  - plugin: markdown
    config: { outDir: ./triage-reports }
store:                     # optional: memory between runs
  plugin: json-file
  config: { path: ./.razo/triage-state.json }
rules:                     # optional; DESIGN.md §6 defaults, flaky and environment thresholds still provisional
  env: { windowMinutes: 10, minFiles: 5 }
  flaky: { lookbackRuns: 10, quarantineSuggestAfter: 3 }
  regression: { stableRuns: 3 }
```

Offline: `code: { plugin: commits-json, config: { path: ./commits.json } }`
reads a commits list shaped like the ones under `fixtures/`.

## State between runs in CI

With a `store` configured, `triage run` records the run and its clusters in
the store file. A CI job keeps no disk between runs, so the state travels as
an artifact named `razo-triage-state`:

- `triage pull` restores the most recent one into the store file before
  pulling any run. When none exists it says so and starts empty.
- After `triage run`, the workflow uploads the store file. GitHub's API
  cannot create artifacts from outside the runner, so this is a workflow
  step, not a CLI feature:

```yaml
on:
  schedule:
    - cron: '0 7 * * 1-5'
  workflow_dispatch:

# One triage at a time: two overlapping runs would each upload a state
# that ignores the other's.
concurrency:
  group: razo-triage
  cancel-in-progress: false

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx triage pull --since 7d
        env: { GITHUB_TOKEN: ${{ secrets.TRIAGE_TOKEN }} }
      - run: npx triage run --since 24h --lookback 14d
        env: { GITHUB_TOKEN: ${{ secrets.TRIAGE_TOKEN }} }
      # Only scheduled runs on the base branch write state: a manual run or
      # a PR must never become the state the next morning restores from.
      - uses: actions/upload-artifact@v4
        if: github.event_name == 'schedule' && github.ref_name == 'main'
        with:
          name: razo-triage-state
          path: .razo/triage-state.json
          retention-days: 90
```

`triage pull` restores only artifacts uploaded by runs of `baseBranch`.
The file carries a `schemaVersion`; a file or artifact with an unknown
version is an error rather than a silent empty start, and
`triage pull --reset-state` starts from an empty state on purpose. The
state also records the signature algorithm version: when a new build
changes how signatures are computed, `triage run` warns that the previous
clusters will not be recognized.

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
