# Morning triage — Design document for the open engine

Package: `@razohq/triage` (location: `packages/triage`)

This document covers the open engine: the contracts, the deterministic core, the local and GitHub adapters, the Markdown report and the local SQLite store. Model-assisted diagnosis, interactive notifications, issue trackers, the Postgres store and the collector that reads from razo-cloud live in razo-cloud and are designed in their own document; they consume this engine through its ports and its canonical model.

## 1. Goal

Every morning, read the results of the Playwright runs since the last triage, group the failures by cause, classify them, identify suspect commits, and deliver a prioritized report with evidence and one suggested action per group.

The user should be able to finish the daily triage in a few minutes by reading the report, without opening CI.

## 2. Scope

Included:

- Playwright results narrated by razo, read from the `razo-steps.json` artifacts of CI.
- Code context from the version control system (GitHub first).
- Clustering, classification and suspect commits, all deterministic.
- A report in Markdown and JSON.
- Local memory of clusters and actions (SQLite store).
- Integrations extensible through adapters (plugins) with contract kits.

Out of scope for this document (they live in razo-cloud):

- Model-assisted diagnosis over an already computed summary.
- Interactive notifications and execution of approved actions.
- Issue trackers (duplicate search, creation and comments with approval). The `IssueTracker` port and its contract kit are part of the engine; the real adapters are not.
- Postgres store and the collector that reads runs from razo-cloud.

Out of scope in general:

- Other test frameworks (Cypress, JUnit, etc.). The `ResultSource` interface allows them later, but none is implemented.
- Fixing tests or merging changes automatically.
- Any write to an external system: this engine only reads.

## 3. Principles

1. **Deterministic.** Grouping, classifying and finding suspects is done with rules and data. Any model-assisted interpretation stays outside the engine and only consumes an already computed summary; it can never raise a confidence nor change a `high`-confidence category decided by the rules.
2. **The core knows no integrations.** `core/` uses only the canonical model and the `ports/` interfaces. It never imports adapters, external services or razo internals.
3. **Evidence always visible.** Every verdict shows SHAs, commits, signature and confidence level. A verdict without evidence is not reported as reliable.
4. **Read-only.** The engine reads runs and code, and writes reports and its own local memory. Any write to an external system requires human approval and lives outside this document.
5. **Better "I don't know" than a confident mistake.** Under ambiguity the category is `unknown` or the confidence is `low`.

## 4. Pipeline

```
trigger → collect → cluster → history → suspects → classify → report → feedback
```

| Stage | Responsibility |
|---|---|
| trigger | Cron or manual command. Defines the window (since the last triage). |
| collect | `ResultSource.fetchRuns(since)` → `TestRun[]` |
| cluster | Groups failed attempts by signature → `Cluster[]` |
| history | Per test: SHA range on the base branch, prior stability and alternations |
| suspects | Commits between the last green SHA and the first red SHA, scored by touched components |
| classify | Applies the rules of section 6 → category + confidence + evidence |
| report | Builds the `TriageReport` and sends it through every `Notifier` |
| feedback | Records the user's actions in the store and updates the clusters' state |

Every stage is deterministic. The stages razo-cloud adds on the outside (assisted diagnosis, trackers, interactive actions) sit between `classify` and `report`, consume `TriageItem[]`, and never change what the rules decided with `high` confidence.

## 5. Canonical data model

```ts
export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

export interface TestRun {
  id: string;
  sha: string;
  branch: string;
  startedAt: string;   // ISO 8601
  finishedAt: string;
  source: string;      // name of the ResultSource that produced it
  results: TestResult[];
}

export interface TestResult {
  testId: string;               // stable across runs: file + full title + project
  title: string;
  file: string;
  project?: string;
  status: TestStatus;           // final status
  attempts: Attempt[];          // retries included
  durationMs: number;
  workerIndex?: number;
  error?: TestError;
  touchedComponents?: string[]; // distinct `controlType "name"` from razo-steps.json's StepEvents
  healedLocators?: Array<{ from: string; to: string }>; // steps that healed: evidence for stale-test, never a confidence boost
  controls?: TouchedControl[];  // { controlType, name, selector }: what suspects matches against diffs
  traceUrl?: string;
}

export interface Attempt {
  status: TestStatus;
  durationMs: number;
  error?: TestError;
}

export interface TouchedControl {
  controlType: string;
  name: string;
  selector: string;
}

export interface TestError {
  message: string;
  stack?: string;
  signature: string;            // errorSignature(message): the core computes it, the adapter copies it
}

export type Category = 'regression' | 'flaky' | 'environment' | 'stale-test' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type ClusterState = 'new' | 'acknowledged' | 'ticketed' | 'flaky' | 'ignored' | 'resolved';

export interface Cluster {
  id: string;                   // hash of the signature
  signature: string;
  failures: FailureRef[];
  category: Category;
  confidence: Confidence;
  novelty: 'new' | 'recurring';
  firstSeenAt: string;
  lastSeenAt: string;
  lastGreenSha?: string;
  firstRedSha?: string;
  suspectCommits: SuspectCommit[];
  linkedIssue?: IssueRef;
  state: ClusterState;
}

export interface FailureRef {
  runId: string;
  testId: string;
  sha: string;
}

export interface SuspectCommit {
  sha: string;
  message: string;
  author: string;
  overlappingComponents: string[]; // components touched by both the test and the commit
  score: number;
}

export interface Evidence {
  kind: 'sha-range' | 'commit' | 'signature' | 'retry' | 'history' | 'trace';
  description: string;
  url?: string;
}

export interface Verdict {
  clusterId: string;
  category: Category;
  confidence: Confidence;
  summary: string;
  nextStep: string;
  evidence: Evidence[];
  origin: 'rules' | 'llm';      // 'llm' is produced by razo-cloud over this same model; the engine only emits 'rules'
  disagreement?: string;        // recorded by razo-cloud when its diagnosis contradicts the rules
}

export interface IssueRef {
  tracker: string;
  key: string;
  url: string;
  status: string;
}

export interface IssueDraft {
  title: string;
  body: string;
  signature: string;
  labels: string[];
}

export interface TriageReport {
  generatedAt: string;
  window: { from: string; to: string };
  totals: { tests: number; failures: number; clusters: number };
  items: Array<{ cluster: Cluster; verdict: Verdict; proposedActions: ProposedAction[] }>;
}

export type ProposedAction =
  | { type: 'create-issue'; draft: IssueDraft }
  | { type: 'comment-issue'; issue: IssueRef; body: string }
  | { type: 'mark-flaky' }
  | { type: 'quarantine' }
  | { type: 'ignore' };
```

## 6. Classification rules

Evaluated in this order; the first rule that applies decides the category. Every threshold is configurable. **The `flaky` and `environment` thresholds are provisional** until calibrated with real nightly data.

1. **environment**
   - Within a window of `env.windowMinutes` (default 10) that includes at least one of the cluster's runs, at least `env.minFiles` distinct files (default 5) fail with network, navigation-timeout or 5xx signatures. A 4xx during navigation is the app answering, not the environment failing: it is never an environment signature.
   - Confidence `high` when there are no new commits in the range; `medium` otherwise.

2. **flaky**
   - On the same SHA, the test has at least one `passed` and one `failed` attempt (passing on retry counts).
   - Or, across the last `flaky.lookbackRuns` runs (default 10), it alternates results without a SHA change.
   - Confidence `high` when it happens on the same SHA; `medium` when only the history shows it.

3. **stale-test**
   - The signature is a locator not found, strict mode or element not visible.
   - And one of the test's `touchedComponents` is modified by a commit in the `lastGreenSha..firstRedSha` range.
   - Confidence `medium` by default (telling an outdated test from a real regression needs human judgment). The test's `healedLocators` add evidence but never raise the confidence to `high`.

4. **regression**
   - The test passed in the last `regression.stableRuns` runs (default 3) up to `lastGreenSha`.
   - It fails on every attempt since `firstRedSha`.
   - Confidence `high` when at least one suspect commit has overlapping components; `medium` otherwise.

5. **unknown**
   - No rule applies, or there is not enough history.

### Base branch

`lastGreenSha`, `firstRedSha` and the prior stability (`regression.stableRuns`) are computed only from runs of `baseBranch` (default `main`). PR runs interleave with the base branch's, and if they counted, a green PR run would close a red streak that `main` never saw. Same-SHA alternations (`flaky`) do look at every branch: one commit that passes and fails is flaky on any branch.

### Clusters whose tests have different histories

A cluster groups by signature, and several tests may share it with different histories. `classify` evaluates the rules per test and resolves like this:

- **Unanimity:** every test yields the same category → that category, with the lowest confidence among them.
- **No unanimity:** the majority's category, with the confidence one level below the lowest of that majority (`high` → `medium`, `medium` → `low`), and the mix as `history` evidence: which tests yielded which category.
- **Tie:** `unknown` with `low` confidence, with the mix as evidence.

### Suspect commits

- Range: `lastGreenSha..firstRedSha` through `CodeContext.commitsBetween`.
- Score: number of overlapping components between the test's `controls` and the commit's files. The reference logic is `matchControlsToDiff` in razo-cloud (private repo); `core/suspects.ts` reimplements it over `ChangedFile.patch` without importing anything from razo-cloud, with these rules:
  - A control's needles are its name and the quoted values of its selector (testid, role name). Needles shorter than 4 characters and generic ones (`btn`, `button`, `input`, `row`, `item`, `text`…) are dropped: they would turn every commit into a suspect.
  - A needle matches only as a whole token on a `+`/`-` line: `order` does not match `reorder`.
  - A file without a patch (binary or truncated) or a removed file whose name carries a component of the test is marked **unevaluable** and goes into the verdict's evidence, without a score. A file without a patch that names nothing is ignored.
- At most 3 commits are reported per cluster.

## 7. State and memory

Persistence is one more port, `TriageStore`. The core does not know which database is behind it; it only asks for and stores the canonical model. The razo package persists nothing, so the triage store is its own.

```ts
export interface TriageRunRecord {
  id: string;
  generatedAt: string;
  window: { from: string; to: string };
  totals: { tests: number; failures: number; clusters: number };
  durationMs: number;
}

export interface TriageAction {
  clusterId: string;
  action: ProposedAction['type'] | 'acknowledge';
  user: string;
  at: string;
  payload?: unknown;
}

export interface TriageStore {
  lastTriageAt(): Promise<Date | null>;
  loadClusters(): Promise<Cluster[]>;
  saveClusters(clusters: Cluster[]): Promise<void>;
  recordRun(run: TriageRunRecord): Promise<void>;
  recordAction(action: TriageAction): Promise<void>;
  actionsFor(clusterId: string): Promise<TriageAction[]>;
}
```

Adapter: `sqlite` (Phase 3), a local file with no server, to run the triage from CI or from a development machine. Other stores are implemented against the interface only; the core does not change.

The `store` contract kit is added in Phase 3 together with the first adapter. It verifies, at minimum, that `saveClusters` followed by `loadClusters` returns what was saved, that `lastTriageAt` is `null` on an empty store and advances with each `recordRun`, and that `actionsFor` returns the actions in order.

State rules:

- A cluster in state `ignored` or `flaky` is not reported as new; it appears in a compact section.
- A cluster with no failures for `state.resolveAfterRuns` runs (default 3) becomes `resolved`.
- A test marked `flaky` `flaky.quarantineSuggestAfter` times (default 3) produces the suggested action `quarantine`.

## 8. Integrations (ports)

```ts
export interface ResultSource {
  fetchRuns(since: Date): Promise<TestRun[]>;
}

export interface CodeContext {
  commitsBetween(fromSha: string, toSha: string): Promise<Commit[]>;
  changedFiles(sha: string): Promise<ChangedFile[]>;
}

export interface ChangedFile {
  filename: string;
  patch?: string;   // unified diff; absent for binary or truncated entries
  status?: 'added' | 'modified' | 'removed' | 'renamed';  // as the VCS reports it; removed never scores
}

export interface IssueTracker {   // port and contract kit in the engine; the real adapters live in razo-cloud
  findBySignature(signature: string): Promise<IssueRef[]>;
  create(draft: IssueDraft): Promise<IssueRef>;               // requires approval
  comment(issue: IssueRef, body: string): Promise<void>;      // requires approval
}

export interface Notifier {
  send(report: TriageReport): Promise<void>;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url?: string;
}
```

### Plugins

```ts
export type PluginKind = 'source' | 'code' | 'tracker' | 'notifier' | 'store';

/** Structural: any object with a throwing `parse` fits. A zod schema satisfies it unchanged. */
export interface ConfigSchema<Config> {
  parse(input: unknown): Config;
}

export interface TriagePlugin<Kind extends PluginKind, Config> {
  name: string;                                   // kebab-case, e.g. 'github'
  kind: Kind;
  configSchema: ConfigSchema<Config>;
  create(config: Config): AdapterOf[Kind];        // ResultSource | CodeContext | IssueTracker | Notifier | TriageStore
}
```

The `store` kind exists in the type from Phase 3 on; Phase 1 implements the other four.

- Package name for external plugins: `triage-plugin-<name>`.
- Every plugin must pass the contract test kit of its `kind`, published at `@razohq/triage/contract`. Each kit receives a factory that returns the adapter already loaded with the kit's `seed` and returns runner-agnostic cases (`ContractCase[]`, assertions with `node:assert`); `runContract(cases, test)` registers them with node:test, vitest or jest.
- Secrets are read from environment variables referenced in the config, never in plain text.
- Deduplication in trackers: the signature is stored on the ticket (label or field) so `findBySignature` is exact.

## 9. Configuration

```yaml
# triage.config.yaml
schedule: "0 7 * * 1-5"
baseBranch: main   # branch whose runs define green and red; see section 6

source:
  plugin: razo-source
  config:
    dataDir: ./.razo

pull:                # triage pull: GitHub Actions artifacts → dataDir
  repo: owner/repo
  token: ${GITHUB_TOKEN}
  workflow: e2e.yml  # optional
  branch: main       # optional

code:
  plugin: github     # or commits-json { path } to run without network
  config:
    repo: owner/repo
    token: ${GITHUB_TOKEN}

notifiers:
  - plugin: markdown
    config:
      outDir: ./triage-reports

rules:
  env: { windowMinutes: 10, minFiles: 5 }
  flaky: { lookbackRuns: 10, quarantineSuggestAfter: 3 }
  regression: { stableRuns: 3 }
  state: { resolveAfterRuns: 3 }
```

The `tracker` and `llm` sections and the interactive notifiers are razo-cloud extensions; the engine only accepts keys it does not know when a registered plugin claims them.

The GitHub token needs two read permissions on the repository: **Actions: read** (list runs, list and download artifacts) and **Contents: read** (compare commits and read their diffs). It is referenced from the config as `${GITHUB_TOKEN}`; an unset variable is an error, never an empty string. The package README has the full guide.

## 10. Package structure

```
packages/triage/
  DESIGN.md
  package.json            private until Phase 4; entries: ., ./contract, ./fakes
  src/
    index.ts              model, ports, TriagePlugin, errorSignature, clusterIdOf
    contract.ts           entry @razohq/triage/contract
    fakes.ts              entry @razohq/triage/fakes
    core/
      model.ts            section 5
      signature.ts        errorSignature(), clusterIdOf()
      cluster.ts          clusterFailures(): failed attempts grouped by signature
      history.ts          testHistories(), shaRange(), stableBefore(), retryFlip(), sameShaFlips(); base branch
      suspects.ts         needlesFor(), findSuspects() → { suspects, unevaluable }, commitsInRange()
      classify.ts         DEFAULT_RULES, classify(): section 6 rules and mixed-cluster resolution
      pipeline.ts         analyzeWindow(): cluster → history → suspects → classify, window [since, until]
      report.ts           buildReport(): TriageReport with verdicts and proposed actions
    ports/
      result-source.ts
      code-context.ts
      issue-tracker.ts
      notifier.ts
      store.ts            (Phase 3)
      plugin.ts
    contract/
      case.ts             ContractCase, runContract
      seed.ts             fixture shared by every kit
      result-source.ts
      code-context.ts
      issue-tracker.ts
      notifier.ts
      plugin.ts
    fakes/                in-memory adapters and their plugins
    config/
      schema.ts           TriageConfig, parseConfig() with ${VAR} expansion and threshold merging
      load.ts             loadConfig(): YAML
      registry.ts         builtinPlugins, instantiate()
    adapters/
      razo-source/        layout.ts (readRuns, writeRun), map.ts (toTestRun), index.ts (RazoSource, plugin)
      github/             api.ts (GitHubApi, injectable fetch), code-context.ts, index.ts (github plugin)
      commits-json/       network-free CodeContext over a commits.json like the fixtures carry
      markdown-notifier/  render.ts, index.ts (writes .md and .json; readReports)
    collectors/
      unzip.ts            reportsFromZip()
      github-artifacts.ts pullGithubArtifacts(): triage pull
    commands.ts           runTriage(), runPull(), parseDuration()
    cli.ts                triage run | triage pull
  scripts/
    capture-run.mjs       razo test-results → one run in the layout (--synthetic for generated ones)
    capture-razo-demo.mjs regenerates fixtures/razo-demo-pr-1 from the local razo-demo clone
    anonymize-fixture.mjs only for third-party data
  fixtures/               real and synthetic scenarios, see fixtures/README.md
    generator/            Playwright project that produces the two synthetic scenarios
  test/
    signature.test.mjs
    contract.test.mjs     runs every kit against its fake and proves the kit catches broken adapters
    razo-source.test.mjs  mapping, layout and the ResultSource kit against RazoSource
    fixtures.test.mjs     every scenario loads and keeps the invariants; synthetic only where it belongs
    cluster / history / suspects / classify / pipeline / report .test.mjs
    anonymize.test.mjs
    markdown-notifier / github-api / github-code-context / commits-json / github-artifacts / config / cli .test.mjs
```

Monorepo conventions: tsup, `tsc --noEmit`, `node --test` against `dist/`, no new runtime dependencies.

## 11. Phases

### Phase 1 — Contracts ✅ (completed 2026-09-24)
- Canonical model, `ports/` interfaces, `TriagePlugin` type.
- Contract test kit per `kind`.
- Fake (in-memory) adapters that pass the kit.
- **Done when:** the contract tests run in CI and the fake adapters pass them.

Deviations from the original design, with their reason:

1. **The core computes the signature.** `core/signature.ts` exports `errorSignature(message)` and the `ResultSource` kit verifies that every `TestError.signature` equals `errorSignature(message)`. If every source normalized differently, clusters would not cross sources. The normalization collapses only machine-generated noise: ISO timestamps, UUIDs, hexadecimal or numeric ids of 8+ characters, and ports after a host. Quoted values, control names and short assertion numbers are kept: two failures that differ in those are two different causes.
2. **`CodeContext.changedFiles` returns `ChangedFile[]`, not `string[]`.** Without the patch, `core/suspects.ts` cannot search for needles and there would be no equivalent of `matchControlsToDiff`, which lives in razo-cloud and the core cannot import.
3. **`configSchema` is structural.** `{ parse(input: unknown): Config }` instead of `ZodSchema`. A zod schema satisfies it unchanged and the core does not drag zod in, which is a dependency of no package in the repo.
4. **`Cluster.id` is `clusterIdOf(signature)`**, SHA-1 truncated to 12 hexadecimal characters, in the same module as the signature. The design said "hash of the signature" without defining it.

### Phase 2 — Local MVP
- `razo-source` adapter, `github` adapter, `markdown` notifier.
- `cluster`, `history`, `suspects` and `classify` with tests based on real Playwright fixtures.
- CLI `triage pull` that materializes historical runs and `triage run` that generates the Markdown report.
- **Done when:** the report is generated over a real nightly run and the categories match manual judgment for most clusters.

### Phase 3 — Local memory
- `TriageStore` port, its contract kit and the `sqlite` adapter; cluster states, novelty and days open.
- Workflow re-runs as flaky evidence: the collector stores `run_attempt` in `run.json` and, when the same SHA has more than one workflow attempt, `classify` adds `retry` evidence to the cluster. Today `/actions/runs` lists only the latest attempt; earlier ones have to be fetched through `/actions/runs/{id}/attempts/{n}`.
- **Done when:** two consecutive days do not repeat an already seen cluster as "new".

### Phase 4 — Public SDK
- Documentation of the plugin contract and a template plugin.
- A second adapter of each kind implemented against the interface only, outside the monorepo, as proof of the SDK.
- Streaming download of large artifacts: today the collector loads the whole zip into memory before filtering its entries; with traces and videos from a large suite the archive has to be read in parts and only the `razo-steps.json` entries extracted.
- **Done when:** an external adapter works with no changes in `core/`.

## 12. Metrics

- Daily time spent on triage.
- Percentage of verdicts accepted unchanged.
- False-regression rate (`regression` clusters that turned out not to be). The main credibility metric.

## 13. Open decisions

- Criteria for extracting the triage as a product independent of razo.
- When to publish `@razohq/triage` to npm: at the close of Phase 4, with the SDK documented.
