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
  touchedComponents?: string[]; // `controlType "name"` distintos de los StepEvents de razo-steps.json
  healedLocators?: Array<{ from: string; to: string }>; // steps que sanaron: suman evidencia a stale-test, nunca suben la confianza a high
  controls?: TouchedControl[];  // { controlType, name, selector }: lo que suspects cruza con los diffs
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

Se evalúan en este orden; la primera que aplica define la categoría. Todos los umbrales son configurables. **Los umbrales de `flaky` y `environment` son provisionales** hasta calibrarlos con datos reales de corridas nocturnas.

1. **environment**
   - Within a window of `env.windowMinutes` (default 10) that includes at least one of the cluster's runs, at least `env.minFiles` distinct files (default 5) fail with network, navigation-timeout or 5xx signatures. A 4xx during navigation is the app answering, not the environment failing: it is never an environment signature.
   - Confidence `high` when there are no new commits in the range; `medium` otherwise.

2. **flaky**
   - On the same SHA, the test has at least one `passed` and one `failed` attempt (passing on retry counts).
   - Or, across the last `flaky.lookbackRuns` runs (default 10), it alternates results without a SHA change.
   - Confidence `high` when it happens on the same SHA; `medium` when only the history shows it.

3. **stale-test**
   - La firma corresponde a un locator no encontrado, strict mode o elemento no visible.
   - Y alguno de los `touchedComponents` del test aparece modificado en los commits del rango `lastGreenSha..firstRedSha`.
   - Confianza `medium` por defecto (distinguir test desactualizado de regresión real requiere criterio humano). Los `healedLocators` del test suman evidencia, pero nunca suben la confianza a `high`.

4. **regression**
   - The test passed in the last `regression.stableRuns` runs (default 3) up to `lastGreenSha`.
   - It fails on every attempt since `firstRedSha`.
   - Confidence `high` when at least one suspect commit has overlapping components; `medium` otherwise.

5. **unknown**
   - No rule applies, or there is not enough history.

### Rama base

`lastGreenSha`, `firstRedSha` y la estabilidad previa (`regression.stableRuns`) se calculan sólo con corridas de `baseBranch` (default `main`). Las corridas de PR se intercalan con las de la rama base y, si contaran, una corrida verde de un PR cerraría una racha roja que `main` nunca vio. Las alternancias con el mismo SHA (`flaky`) sí miran todas las ramas: un mismo commit que pasa y falla es flaky en cualquier rama.

### Clusters con tests de historias distintas

Un cluster agrupa por firma, y varios tests pueden compartirla con historias diferentes. `classify` evalúa las reglas por test y resuelve así:

- **Unanimidad:** todos los tests dan la misma categoría → esa categoría, con la confianza más baja entre ellos.
- **Sin unanimidad:** la categoría de la mayoría, con la confianza un nivel por debajo de la más baja de esa mayoría (`high` → `medium`, `medium` → `low`), y la mezcla como evidencia de tipo `history`: qué tests dieron qué categoría.
- **Empate:** `unknown` con confianza `low`, con la mezcla como evidencia.

### Commits sospechosos

- Rango: `lastGreenSha..firstRedSha` vía `CodeContext.commitsBetween`.
- Puntuación: cantidad de componentes superpuestos entre los `controls` del test y los archivos del commit. La lógica de referencia es `matchControlsToDiff` de razo-cloud (repo privado); `core/suspects.ts` la reimplementa sobre `ChangedFile.patch` sin importar nada de razo-cloud, con estas reglas:
  - Las agujas de un control son su nombre y los valores entre comillas de su selector (testid, nombre de rol). Se descartan las de menos de 4 caracteres y las genéricas (`btn`, `button`, `input`, `row`, `item`, `text`…): convertirían cualquier commit en sospechoso.
  - Una aguja matchea sólo como token entero en una línea `+`/`-`: `order` no matchea `reorder`.
  - Un archivo sin patch (binario o truncado) o borrado cuyo nombre lleva el de un componente del test se marca como **no evaluable** y va a la evidencia del veredicto, sin puntaje. Un archivo sin patch que no nombra nada se ignora.
- Se reportan como máximo 3 commits por cluster.

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
  patch?: string;   // diff unificado; ausente en binarios o entradas truncadas
  status?: 'added' | 'modified' | 'removed' | 'renamed';  // como lo informa el VCS; removed nunca puntúa
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
baseBranch: main   # rama cuyas corridas definen verde y rojo; ver sección 6

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
      cluster.ts          clusterFailures(): intentos fallidos agrupados por firma
      history.ts          testHistories(), shaRange(), stableBefore(), retryFlip(), sameShaFlips(); rama base
      suspects.ts         needlesFor(), findSuspects() → { suspects, unevaluable }, commitsInRange()
      classify.ts         DEFAULT_RULES, classify(): reglas de la sección 6 y resolución de clusters mixtos
      pipeline.ts         analyzeWindow(): cluster → history → suspects → classify
      report.ts           (Fase 2b)
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
    fakes/                adaptadores en memoria y sus plugins
    llm/                  (Fase 3)
    config/               (Fase 2b)
    adapters/
      razo-source/        layout.ts (readRuns, writeRun), map.ts (toTestRun), index.ts (RazoSource, plugin)
      github/             (Fase 2b)
      markdown-notifier/  (Fase 2b)
    cli.ts                (Fase 2b)
  scripts/
    capture-run.mjs       test-results de razo → una corrida del layout (--synthetic para los generados)
    capture-razo-demo.mjs regenera fixtures/razo-demo-pr-1 desde el clon local de razo-demo
    anonymize-fixture.mjs sólo para datos de terceros
  fixtures/               escenarios reales y sintéticos, ver fixtures/README.md
    generator/            proyecto Playwright que produce los dos escenarios sintéticos
  test/
    signature.test.mjs
    contract.test.mjs     corre cada kit contra su fake y prueba que el kit detecta adaptadores rotos
    razo-source.test.mjs  mapeo, layout y kit de ResultSource contra RazoSource
    fixtures.test.mjs     cada escenario carga y respeta las invariantes; synthetic sólo donde corresponde
    cluster / history / suspects / classify / pipeline .test.mjs
    anonymize.test.mjs
```

Monorepo conventions: tsup, `tsc --noEmit`, `node --test` against `dist/`, no new runtime dependencies.

## 11. Phases

### Phase 1 — Contracts ✅ (completed 2026-09-24)
- Canonical model, `ports/` interfaces, `TriagePlugin` type.
- Contract test kit per `kind`.
- Fake (in-memory) adapters that pass the kit.
- **Done when:** the contract tests run in CI and the fake adapters pass them.

Deviations from the original design, with their reason:

### Fase 2 — MVP local
- Adaptador `razo-source`, adaptador `github`, notificador `markdown`.
- `cluster`, `history`, `suspects` y `classify` con tests basados en fixtures reales de Playwright.
- CLI `triage pull` que materializa corridas históricas y `triage run` que genera el reporte en Markdown.
- **Hecho cuando:** el reporte se genera sobre una corrida nocturna real y las categorías coinciden con el criterio manual en la mayoría de los clusters.

#### Diseño aprobado el 2026-09-24

**Lo que produce razo hoy.** El reporter escribe un `razo-steps.json` por test en `test-results/<archivo>-<título>[-retryN]/`, sin SHA, rama, id de corrida, project ni hora de la corrida; los reintentos son carpetas hermanas. Playwright borra `test-results` al iniciar, así que localmente no se acumula historia. El CI de razo sube artefactos sólo en fallo; razo-demo no sube ninguno y manda todo a razo.ar, que no tiene API de lectura y guarda los reintentos como reportes duplicados sin orden.

**razo-source es un lector puro; la red vive en recolectores.** El plugin lee un directorio local:

```
<dataDir>/runs/<runId>/run.json                 { id, sha, branch, startedAt, finishedAt, ciUrl?, prNumber?, synthetic? }
<dataDir>/runs/<runId>/reports/**/razo-steps.json
```

`triage pull --from github-artifacts` materializa ese layout de forma incremental, con caché por `runId`, leyendo los workflow runs de GitHub (`head_sha`, `head_branch`, `run_started_at`, `updated_at`) y descargando el artefacto de `test-results`. `--from razo-cloud` se agrega después sin tocar el plugin, cuando exista un endpoint de lectura. El plugin pasa el kit de `ResultSource` con una factory que escribe la seed en un directorio temporal; los recolectores se prueban con respuestas HTTP grabadas.

Mapeo a `TestResult`: `testId` es `file::title`, más `::project` cuando el reporte lo trae. Si el reporte trae `retry` o `project`, se usan; si no, `retry` se reconstruye desde el sufijo `-retryN` de la carpeta y `project` queda ausente. Los intentos se ordenan por `retry`; el estado final es el de la N más alta. El reporter de razo no se modifica en la rama de la Fase 2. El error es el del reporte o el del último step fallido, con `signature` de `errorSignature`. `touchedComponents` son los `controlType "name"` distintos de los steps. `healedLocators` recoge los `healed` de los steps. `traceUrl` apunta al `ciUrl` de la corrida.

**Fixtures reales**, en `packages/triage/fixtures/<escenario>/` con el layout de `dataDir` más un `commits.json` con diffs reales para `MemoryCodeContext`:

- `razo-demo-pr-1`: corrida verde en el commit base y roja en el del PR, regeneradas corriendo Playwright en cada SHA del repo público razohq/razo-demo. Categoría esperada: `stale-test`, confianza `medium`.
- `razo-suite`: una corrida de la suite de razo (45 reportes, 1 fallo real, steps con healing y `domCandidates`).
- `cloud-examples`: los tres ejemplos de razo-cloud (botón oculto, conteo de filas, acción en fila).
- `synthetic-flaky` y `synthetic-environment`: generados por `fixtures/generator`, un proyecto Playwright mínimo contra la página demo de razo con `retries: 2`, un test que falla en el primer intento y una corrida con el servidor caído. El reporter es real; el comportamiento es sintético y el fixture lo declara en su README y con `synthetic: true` en `run.json`.

Anonimización: sólo hace falta si alguna vez se toman datos de un proyecto ajeno. `scripts/anonymize-fixture.mjs` reemplaza de forma determinista títulos, rutas, nombres de control y valores entre comillas preservando estructura, hosts a `example.com` y autores a `author-N`.

**Orden de implementación: `cluster` → `history` → `suspects` → `classify`.** Tres de las cuatro reglas de clasificación dependen de los sospechosos o del rango de commits, así que `classify` va último aunque el pipeline de la sección 4 lo liste antes. `history.ts` es un módulo nuevo: por test, la secuencia de SHA y estado con sus intentos hasta `lookbackRuns`; de ahí salen `lastGreenSha`, `firstRedSha` y las alternancias de `flaky`.

**Cambios fuera de triage, aprobados como PRs aparte:**

- razo: agregar `retry` y `project` al `AiTestReport` que escribe el reporter y el project al nombre de carpeta. Aditivo; la Fase 2 funciona sin él reconstruyendo `retry` desde el nombre de carpeta.
- razo-demo: subir `test-results` como artefacto en cada corrida con `if: always()`, nombre por corrida y retención explícita, para que exista historia real que `triage pull` pueda leer.

### Fase 3 — Memoria y notificación
- Puerto `TriageStore`, su kit de contrato y el adaptador `sqlite`; estados de cluster, novedad y días abiertos.
- Diagnóstico LLM con regla de credibilidad.
- Notificador Slack.
- **Hecho cuando:** dos días consecutivos no repiten como "nuevo" un cluster ya visto.

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
