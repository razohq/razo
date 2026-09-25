# Triage matutino — Documento de diseño del motor abierto

Package: `@razohq/triage` (location: `packages/triage`)

Este documento cubre el motor abierto: los contratos, el core determinista, los adaptadores locales y de GitHub, el reporte en Markdown y el store SQLite local. El diagnóstico asistido por modelos, las notificaciones interactivas, los trackers de tickets, el store Postgres y el recolector desde razo-cloud viven en razo-cloud y se diseñan en su propio documento; consumen este motor a través de sus puertos y su modelo canónico.

## 1. Objetivo

## 1. Goal

Every morning, read the results of the Playwright runs since the last triage, group the failures by cause, classify them, identify suspect commits, and deliver a prioritized report with evidence and one suggested action per group.

The user should be able to finish the daily triage in a few minutes by reading the report, without opening CI.

## 2. Scope

- Resultados de Playwright narrados por razo, leídos desde los artefactos `razo-steps.json` de CI.
- Contexto de código desde el sistema de control de versiones (GitHub primero).
- Clustering, clasificación y commits sospechosos, todo determinista.
- Reporte en Markdown y JSON.
- Memoria local de clusters y acciones (store SQLite).
- Integraciones extensibles mediante adaptadores (plugins) con kits de contrato.

Fuera de alcance de este documento (viven en razo-cloud):

- Diagnóstico asistido por modelos sobre un resumen ya calculado.
- Notificaciones interactivas y ejecución de acciones aprobadas.
- Trackers de tickets (búsqueda de duplicados, creación y comentario con aprobación). El puerto `IssueTracker` y su kit de contrato sí son parte del motor; los adaptadores reales no.
- Store Postgres y recolector de corridas desde razo-cloud.

Fuera de alcance en general:

- Otros frameworks de test (Cypress, JUnit, etc.). La interfaz `ResultSource` lo permite a futuro, pero no se implementa.
- Arreglar tests o mergear cambios automáticamente.
- Cualquier escritura en sistemas externos: este motor sólo lee.

- Model-assisted diagnosis over an already computed summary.
- Interactive notifications and execution of approved actions.
- Issue trackers (duplicate search, creation and comments with approval). The `IssueTracker` port and its contract kit are part of the engine; the real adapters are not.
- Postgres store and the collector that reads runs from razo-cloud.

1. **Determinístico.** Agrupar, clasificar y buscar sospechosos se hace con reglas y datos. Cualquier interpretación asistida por modelos queda fuera del motor y sólo consume un resumen ya calculado; nunca puede subir una confianza ni cambiar una categoría `high` de las reglas.
2. **El núcleo no conoce integraciones.** `core/` solo usa el modelo canónico y las interfaces de `ports/`. Nunca importa adaptadores, servicios externos ni código interno de razo.
3. **Evidencia siempre visible.** Todo veredicto muestra SHA, commits, firma y nivel de confianza. Un veredicto sin evidencia no se reporta como confiable.
4. **Solo lectura.** El motor lee corridas y código y escribe reportes y su propia memoria local. Toda escritura en un sistema externo requiere aprobación humana y vive fuera de este documento.
5. **Mejor "no sé" que un error confiado.** Ante ambigüedad, la categoría es `unknown` o la confianza es `low`.

## 4. Pipeline

```
trigger → collect → cluster → history → suspects → classify → report → feedback
```

| Etapa | Responsabilidad |
|---|---|
| trigger | Cron o comando manual. Define la ventana (desde el último triage). |
| collect | `ResultSource.fetchRuns(since)` → `TestRun[]` |
| cluster | Agrupa los intentos fallidos por firma → `Cluster[]` |
| history | Por test, rango de SHAs en la rama base, estabilidad previa y alternancias |
| suspects | Commits entre último SHA verde y primer SHA rojo, puntuados por componentes tocados |
| classify | Aplica las reglas de la sección 6 → categoría + confianza + evidencia |
| report | Arma `TriageReport` y lo envía por cada `Notifier` |
| feedback | Registra acciones del usuario en el store y actualiza el estado de los clusters |

Todas las etapas son deterministas. Las etapas que razo-cloud agrega por fuera (diagnóstico asistido, trackers, acciones interactivas) se insertan entre `classify` y `report` consumiendo `TriageItem[]`, y nunca modifican lo que las reglas decidieron con confianza `high`.

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
  origin: 'rules' | 'llm';      // 'llm' lo produce razo-cloud sobre este mismo modelo; el motor sólo emite 'rules'
  disagreement?: string;        // registrado por razo-cloud cuando su diagnóstico contradice a las reglas
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
   - En una ventana de `env.windowMinutes` (default 10) que incluya alguna corrida del cluster, al menos `env.minFiles` archivos distintos (default 5) fallan con firmas de red, timeout de navegación o 5xx. Un 4xx durante la navegación es la app respondiendo, no el entorno fallando: nunca es firma de entorno.
   - Confianza `high` si además no hay commits nuevos en el rango; `medium` en otro caso.

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

## 7. Estado y memoria

La persistencia es un puerto más, `TriageStore`. El core no sabe qué base hay detrás; sólo pide y guarda el modelo canónico. El paquete razo no persiste nada, así que el store del triage es propio.

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

Adaptador: `sqlite` (Fase 3), un archivo local, sin servidor, para correr el triage desde CI o desde una máquina de desarrollo. Otros stores se implementan sólo contra la interfaz; el core no cambia.

State rules:

- A cluster in state `ignored` or `flaky` is not reported as new; it appears in a compact section.
- A cluster with no failures for `state.resolveAfterRuns` runs (default 3) becomes `resolved`.
- A test marked `flaky` `flaky.quarantineSuggestAfter` times (default 3) produces the suggested action `quarantine`.

- Un cluster en estado `ignored` o `flaky` no se reporta como nuevo; aparece en una sección compacta.
- Un cluster sin fallas durante `state.resolveAfterRuns` corridas (default 3) pasa a `resolved`.
- Un test marcado `flaky` `flaky.quarantineSuggestAfter` veces (default 3) genera la acción sugerida `quarantine`.

## 8. Integraciones (puertos)

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

export interface IssueTracker {   // puerto y kit de contrato en el motor; los adaptadores reales viven en razo-cloud
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
  name: string;                                   // kebab-case, ej. 'github'
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

## 9. Configuración

```yaml
# triage.config.yaml
schedule: "0 7 * * 1-5"
baseBranch: main   # rama cuyas corridas definen verde y rojo; ver sección 6

source:
  plugin: razo-source
  config:
    dataDir: ./.razo

pull:                # triage pull: artefactos de GitHub Actions → dataDir
  repo: owner/repo
  token: ${GITHUB_TOKEN}
  workflow: e2e.yml  # opcional
  branch: main       # opcional

code:
  plugin: github     # o commits-json { path } para correr sin red
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

Las secciones `tracker`, `llm` y los notificadores interactivos son extensiones de razo-cloud; el motor ignora claves que no conoce sólo si un plugin registrado las reclama.

El token de GitHub necesita dos permisos de lectura sobre el repositorio: **Actions: read** (listar corridas, listar y descargar artefactos) y **Contents: read** (comparar commits y leer sus diffs). Se referencia desde la config como `${GITHUB_TOKEN}`; una variable no definida es un error, nunca una cadena vacía. El README del paquete tiene la guía completa.

## 10. Estructura del paquete

```
packages/triage/
  DESIGN.md
  package.json            privado hasta la Fase 4; entradas: ., ./contract, ./fakes
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
      pipeline.ts         analyzeWindow(): cluster → history → suspects → classify, ventana [since, until]
      report.ts           buildReport(): TriageReport con veredictos y acciones propuestas
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
    config/
      schema.ts           TriageConfig, parseConfig() con expansión de ${VAR} y merge de umbrales
      load.ts             loadConfig(): YAML
      registry.ts         builtinPlugins, instantiate()
    adapters/
      razo-source/        layout.ts (readRuns, writeRun), map.ts (toTestRun), index.ts (RazoSource, plugin)
      github/             api.ts (GitHubApi, fetch inyectable), code-context.ts, index.ts (plugin github)
      commits-json/       CodeContext sin red sobre un commits.json como el de los fixtures
      markdown-notifier/  render.ts, index.ts (escribe .md y .json; readReports)
    collectors/
      unzip.ts            reportsFromZip()
      github-artifacts.ts pullGithubArtifacts(): triage pull
    commands.ts           runTriage(), runPull(), parseDuration()
    cli.ts                triage run | triage pull
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
    cluster / history / suspects / classify / pipeline / report .test.mjs
    anonymize.test.mjs
    markdown-notifier / github-api / github-code-context / commits-json / github-artifacts / config / cli .test.mjs
```

Convenciones del monorepo: tsup, `tsc --noEmit`, `node --test` contra `dist/`, sin dependencias de runtime nuevas.

## 11. Fases

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
- ✅ 2026-09-25: `triage pull` y `triage run` corren sobre los artefactos reales de razo-demo (cuatro corridas del PR #2, todas verdes: reporte sin fallas). Las categorías se contrastarán con el criterio manual cuando haya corridas nocturnas acumuladas.

#### Diseño aprobado el 2026-09-24

**Lo que produce razo hoy.** El reporter escribe un `razo-steps.json` por test en `test-results/<archivo>-<título>[-retryN]/`, sin SHA, rama, id de corrida, project ni hora de la corrida; los reintentos son carpetas hermanas. Playwright borra `test-results` al iniciar, así que localmente no se acumula historia. El CI de razo sube artefactos sólo en fallo; razo-demo no sube ninguno y manda todo a razo.ar, que no tiene API de lectura y guarda los reintentos como reportes duplicados sin orden.

**razo-source es un lector puro; la red vive en recolectores.** El plugin lee un directorio local:

```
<dataDir>/runs/<runId>/run.json                 { id, sha, branch, startedAt, finishedAt, ciUrl?, prNumber?, synthetic? }
<dataDir>/runs/<runId>/reports/**/razo-steps.json
```

`triage pull` materializa ese layout de forma incremental, con caché por `runId`, leyendo los workflow runs de GitHub (`head_sha`, `head_branch`, `run_started_at`, `updated_at`) y descargando el artefacto de `test-results`. Otros recolectores se agregan sin tocar el plugin. El plugin pasa el kit de `ResultSource` con una factory que escribe la seed en un directorio temporal; los recolectores se prueban con respuestas HTTP grabadas.

Mapeo a `TestResult`: `testId` es `file::title`, más `::project` cuando el reporte lo trae. El error es el del reporte, si no el del último step fallido, y si no un mensaje derivado del test (`<status> without error message: <file> › <title>`), nunca un "unknown error" compartido que agruparía fallas sin relación. Dos reportes con el mismo índice de reintento para un test son una corrida corrupta y se rechazan nombrando ambos archivos. Si el reporte trae `retry` o `project`, se usan; si no, `retry` se reconstruye desde el sufijo `-retryN` de la carpeta y `project` queda ausente. Los intentos se ordenan por `retry`; el estado final es el de la N más alta. El reporter de razo no se modifica en la rama de la Fase 2. El error es el del reporte o el del último step fallido, con `signature` de `errorSignature`. `touchedComponents` son los `controlType "name"` distintos de los steps. `healedLocators` recoge los `healed` de los steps. `traceUrl` apunta al `ciUrl` de la corrida.

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

### Fase 3 — Memoria local
- Puerto `TriageStore`, su kit de contrato y el adaptador `sqlite`; estados de cluster, novedad y días abiertos.
- Reintentos de workflow como evidencia de flaky: el recolector guarda `run_attempt` en `run.json` y, cuando el mismo SHA tiene más de un intento de workflow, `classify` suma evidencia `retry` al cluster. Hoy `/actions/runs` lista sólo el último intento; hace falta pedir los anteriores por `/actions/runs/{id}/attempts/{n}`.
- **Hecho cuando:** dos días consecutivos no repiten como "nuevo" un cluster ya visto.

#### Endurecimiento (menores diferidos de las revisiones de la Fase 2)

Cada uno con su test rojo primero:

1. `suspects`: el match de nombre de archivo para "no evaluable" es por substring, y `-` y `_` cuentan como límite de token en `containsToken`; `order` puntúa `data-testid="order-row"` y `src/reorder.ts` queda como no evaluable para `Order`.
2. `suspects`: el match de agujas distingue mayúsculas; `Place order` no matchea `<button>place order</button>`.
3. `anonymize-fixture`: un step con nombre vacío intercala el reemplazo entre cada carácter del texto.
4. `github-artifacts`: toma el primer artefacto no vencido; con uploads fragmentados o reintentos de workflow pueden mezclarse. Preferir el nombre exacto `<prefijo><run_id>-<run_attempt>` y, si no, fusionar todos los candidatos.
5. `config/registry`: busca plugins sólo por nombre; un futuro tracker `github` chocaría con el plugin de código `github`. Buscar por nombre y kind.
6. `markdown-notifier`: la firma va en un span de un backtick; una firma con backticks lo rompe. Usar bloque cercado o una tirada de N+1 backticks.
7. `cli`: acepta flags desconocidos en silencio (`--sinc 24h` corre con la ventana por defecto). Rechazarlos con código 2.
8. `commands`: `totals.tests` cuenta todas las corridas del lookback, no sólo las de la ventana.
9. `github/api`: los 403 de rate limit y los 401 no muestran `x-ratelimit-reset` ni `Retry-After` en el mensaje.
10. Tests que faltan: la rama de zip sin reportes en el recolector y la paginación de `compare` cuando una página trae menos de lo pedido pero `total_commits` es mayor.

### Fase 4 — SDK público
- Documentación del contrato de plugins y plugin plantilla.
- Un segundo adaptador de cada kind implementado sólo contra la interfaz, fuera del monorepo, como prueba del SDK.
- Descarga en streaming de artefactos grandes: hoy el recolector carga el zip entero en memoria antes de filtrar sus entradas; con traces y videos de una suite grande hace falta leer el archivo por partes y extraer sólo los `razo-steps.json`.
- **Hecho cuando:** un adaptador externo funciona sin cambios en `core/`.

## 12. Métricas

- Tiempo diario dedicado al triage.
- Porcentaje de veredictos aceptados sin cambio.
- Tasa de falsas regresiones (clusters `regression` que resultaron no serlo). Es la métrica principal de credibilidad.

## 13. Decisiones abiertas

- Criterio para extraer el triage como producto independiente de razo.
- Cuándo publicar `@razohq/triage` en npm: al cerrar la Fase 4, con el SDK documentado.