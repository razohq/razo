# Triage matutino — Documento de diseño

Paquete: `@razohq/triage` (ubicación: `packages/triage`)

## 1. Objetivo

Cada mañana, leer los resultados de las corridas de Playwright desde el último triage, agrupar las fallas por causa, clasificarlas, identificar commits sospechosos y entregar un reporte priorizado con evidencia y una acción sugerida por grupo.

El usuario debería poder resolver el triage diario en pocos minutos leyendo el reporte, sin abrir el CI.

## 2. Alcance

Incluido:

- Resultados de Playwright (vía la ingesta existente de razo).
- Contexto de código desde el sistema de control de versiones (GitHub primero).
- Búsqueda de tickets duplicados y creación de tickets con aprobación explícita.
- Reporte por Markdown (MVP) y por Slack (fase 3).
- Integraciones extensibles mediante adaptadores (plugins).

Fuera de alcance (por ahora):

- Otros frameworks de test (Cypress, JUnit, etc.). La interfaz `ResultSource` lo permite a futuro, pero no se implementa.
- Arreglar tests o mergear cambios automáticamente.
- Cualquier escritura en sistemas externos sin aprobación humana.

## 3. Principios

1. **Determinístico primero, LLM al final.** Agrupar, clasificar y buscar sospechosos se hace con reglas y datos. El LLM solo interpreta un resumen ya calculado.
2. **El núcleo no conoce integraciones.** `core/` solo usa el modelo canónico y las interfaces de `ports/`. Nunca importa Jira, Slack, GitHub ni código interno de razo.
3. **Evidencia siempre visible.** Todo veredicto muestra SHA, commits, firma y nivel de confianza. Un veredicto sin evidencia no se reporta como confiable.
4. **Solo lectura por defecto.** Crear o comentar tickets requiere aprobación humana.
5. **Mejor "no sé" que un error confiado.** Ante ambigüedad, la categoría es `unknown` o la confianza es `low`.

## 4. Pipeline

```
trigger → collect → cluster → classify → suspects → diagnose → track → report → feedback
```

| Etapa | Responsabilidad | Determinística |
|---|---|---|
| trigger | Cron o webhook de fin de CI. Define la ventana (desde el último triage). | Sí |
| collect | `ResultSource.fetchRuns(since)` → `TestRun[]` | Sí |
| cluster | Normaliza errores y agrupa fallas por firma → `Cluster[]` | Sí |
| classify | Aplica reglas de la sección 6 → categoría + confianza | Sí |
| suspects | Commits entre último SHA verde y primer SHA rojo, ordenados por componentes tocados | Sí |
| diagnose | LLM sobre un brief por cluster → `Verdict` | No |
| track | Busca tickets por firma; prepara borradores | Sí (lectura) |
| report | Arma `TriageReport` y lo envía por cada `Notifier` | Sí |
| feedback | Registra acciones del usuario y actualiza el estado de los clusters | Sí |

## 5. Modelo de datos canónico

```ts
export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

export interface TestRun {
  id: string;
  sha: string;
  branch: string;
  startedAt: string;   // ISO 8601
  finishedAt: string;
  source: string;      // nombre del ResultSource que lo produjo
  results: TestResult[];
}

export interface TestResult {
  testId: string;               // estable entre corridas: file + título completo + project
  title: string;
  file: string;
  project?: string;
  status: TestStatus;           // estado final
  attempts: Attempt[];          // incluye reintentos
  durationMs: number;
  workerIndex?: number;
  error?: TestError;
  touchedComponents?: string[]; // desde ai-steps.json de razo
  traceUrl?: string;
}

export interface Attempt {
  status: TestStatus;
  durationMs: number;
  error?: TestError;
}

export interface TestError {
  message: string;
  stack?: string;
  signature: string;            // errorSignature(message): la calcula el core, el adaptador la copia
}

export type Category = 'regression' | 'flaky' | 'environment' | 'stale-test' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type ClusterState = 'new' | 'acknowledged' | 'ticketed' | 'flaky' | 'ignored' | 'resolved';

export interface Cluster {
  id: string;                   // hash de signature
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
  overlappingComponents: string[]; // componentes tocados por el test y por el commit
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
  origin: 'rules' | 'llm';
  disagreement?: string;        // si el LLM contradice a las reglas
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

## 6. Reglas de clasificación

Se evalúan en este orden; la primera que aplica define la categoría. Todos los umbrales son configurables.

1. **environment**
   - En una ventana de `env.windowMinutes` (default 10), al menos `env.minFiles` archivos distintos (default 5) fallan con firmas de red, timeout o 5xx.
   - Confianza `high` si además no hay commits nuevos en el rango; `medium` en otro caso.

2. **flaky**
   - Con el mismo SHA, el test tiene al menos un intento `passed` y uno `failed` (incluye pasar en reintento).
   - O en las últimas `flaky.lookbackRuns` corridas (default 10) alterna resultados sin cambio de SHA.
   - Confianza `high` si ocurre con el mismo SHA; `medium` si solo es por historial.

3. **stale-test**
   - La firma corresponde a un locator no encontrado, strict mode o elemento no visible.
   - Y alguno de los `touchedComponents` del test aparece modificado en los commits del rango `lastGreenSha..firstRedSha`.
   - Confianza `medium` por defecto (distinguir test desactualizado de regresión real requiere criterio humano).

4. **regression**
   - El test pasó en las últimas `regression.stableRuns` corridas (default 3) hasta `lastGreenSha`.
   - Falla en todos los intentos desde `firstRedSha`.
   - Confianza `high` si existe al menos un commit sospechoso con componentes superpuestos; `medium` si no.

5. **unknown**
   - Ninguna regla aplica, o no hay historial suficiente.

### Commits sospechosos

- Rango: `lastGreenSha..firstRedSha` vía `CodeContext.commitsBetween`.
- Puntuación: cantidad de componentes superpuestos entre `touchedComponents` del test y los archivos del commit. La lógica de referencia es `matchControlsToDiff` de razo-cloud (repo privado): extrae "agujas" del control (nombre y partes entre comillas del selector, mínimo 3 caracteres) y las busca en las líneas `+`/`-` del patch. `core/suspects.ts` la reimplementa sobre `ChangedFile.patch` sin importar nada de razo-cloud.
- Se reportan como máximo 3 commits por cluster.

## 7. Diagnóstico con LLM

- Se ejecuta solo para clusters `regression`, `stale-test`, `unknown` o con confianza `low`.
- Límite de clusters diagnosticados por corrida: `llm.maxClustersPerRun` (default 5), priorizando nuevos y de mayor impacto.
- Entrada (brief): firma, categoría y confianza de las reglas, tests afectados, commits sospechosos con sus diffs resumidos, fragmento de stack y evidencia.
- Salida: JSON validado con esquema (`category`, `confidence`, `summary`, `nextStep`). Si no valida, se descarta y queda el veredicto de reglas.
- **Regla de credibilidad:** si las reglas dieron confianza `high`, el LLM no puede cambiar la categoría. Si propone otra, se registra en `disagreement`, la confianza baja a `medium` y el reporte muestra ambas.
- El LLM nunca puede subir la confianza a `high` sin evidencia determinística que lo respalde.

## 8. Estado y memoria

La persistencia es un puerto más, `TriageStore`. El core no sabe qué base hay detrás; sólo pide y guarda el modelo canónico. razo no tiene ningún índice SQLite que reutilizar: razo-cloud usa Postgres con drizzle y el paquete razo no persiste nada, así que el store del triage es propio.

```ts
export interface TriageRunRecord {
  id: string;
  generatedAt: string;
  window: { from: string; to: string };
  totals: { tests: number; failures: number; clusters: number };
  durationMs: number;
  llmCostUsd?: number;
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

Adaptadores:

- `sqlite` (Fase 3): un archivo local, sin servidor, para el MVP y para correr el triage desde CI o desde una máquina de desarrollo.
- `postgres` (futuro): cuando el triage viva dentro de razo-cloud, contra su misma base. Se implementa sólo contra la interfaz; el core no cambia.

El kit de contrato de `store` se agrega en la Fase 3 junto con el primer adaptador. Verifica, como mínimo, que `saveClusters` seguido de `loadClusters` devuelve lo guardado, que `lastTriageAt` es `null` en un store vacío y avanza con cada `recordRun`, y que `actionsFor` devuelve las acciones en orden.

Reglas de estado:

- Un cluster en estado `ignored` o `flaky` no se reporta como nuevo; aparece en una sección compacta.
- Un cluster sin fallas durante `state.resolveAfterRuns` corridas (default 3) pasa a `resolved`.
- Un test marcado `flaky` `flaky.quarantineSuggestAfter` veces (default 3) genera la acción sugerida `quarantine`.

## 9. Integraciones (puertos)

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
}

export interface IssueTracker {
  findBySignature(signature: string): Promise<IssueRef[]>;
  create(draft: IssueDraft): Promise<IssueRef>;               // requiere aprobación
  comment(issue: IssueRef, body: string): Promise<void>;      // requiere aprobación
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

/** Estructural: cualquier objeto con un `parse` que lanza sirve. Un esquema zod lo satisface sin cambios. */
export interface ConfigSchema<Config> {
  parse(input: unknown): Config;
}

export interface TriagePlugin<Kind extends PluginKind, Config> {
  name: string;                                   // kebab-case, ej. 'jira'
  kind: Kind;
  configSchema: ConfigSchema<Config>;
  create(config: Config): AdapterOf[Kind];        // ResultSource | CodeContext | IssueTracker | Notifier | TriageStore
}
```

El kind `store` existe en el tipo desde la Fase 3; la Fase 1 implementa los otros cuatro.

- Nombre de paquete para plugins externos: `triage-plugin-<nombre>`.
- Todo plugin debe pasar el kit de tests de contrato de su `kind`, publicado en `@razohq/triage/contract`. Cada kit recibe una factory que devuelve el adaptador ya cargado con la `seed` del kit y devuelve casos independientes del runner (`ContractCase[]`, aserciones con `node:assert`); `runContract(cases, test)` los registra en node:test, vitest o jest.
- Los secretos se leen desde variables de entorno referenciadas en la config, nunca en texto plano.
- Deduplicación en trackers: la firma se guarda en el ticket (label o campo) para que `findBySignature` sea exacto.

## 10. Configuración

```yaml
# triage.config.yaml
schedule: "0 7 * * 1-5"

source:
  plugin: razo
  config:
    dataDir: ./.razo

code:
  plugin: github
  config:
    repo: owner/repo
    token: ${GITHUB_TOKEN}

tracker:
  plugin: jira
  enabled: false
  config:
    baseUrl: https://empresa.atlassian.net
    project: QA
    token: ${JIRA_TOKEN}

notifiers:
  - plugin: markdown
    config:
      outDir: ./triage-reports
  - plugin: slack
    enabled: false
    config:
      webhookUrl: ${SLACK_WEBHOOK_URL}

rules:
  env: { windowMinutes: 10, minFiles: 5 }
  flaky: { lookbackRuns: 10, quarantineSuggestAfter: 3 }
  regression: { stableRuns: 3 }
  state: { resolveAfterRuns: 3 }

llm:
  enabled: true
  maxClustersPerRun: 5
```

## 11. Estructura del paquete

```
packages/triage/
  DESIGN.md
  package.json            privado hasta la Fase 5; entradas: ., ./contract, ./fakes
  src/
    index.ts              modelo, puertos, TriagePlugin, errorSignature, clusterIdOf
    contract.ts           entrada @razohq/triage/contract
    fakes.ts              entrada @razohq/triage/fakes
    core/
      model.ts            sección 5
      signature.ts        errorSignature(), clusterIdOf()
      pipeline.ts         (Fase 2)
      cluster.ts          (Fase 2)
      classify.ts         (Fase 2)
      suspects.ts         (Fase 2)
      report.ts           (Fase 2)
    ports/
      result-source.ts
      code-context.ts
      issue-tracker.ts
      notifier.ts
      store.ts            (Fase 3)
      plugin.ts
    contract/
      case.ts             ContractCase, runContract
      seed.ts             fixture compartida por todos los kits
      result-source.ts
      code-context.ts
      issue-tracker.ts
      notifier.ts
      plugin.ts
    fakes/                adaptadores en memoria y sus plugins
    llm/                  (Fase 3)
    config/               (Fase 2)
    adapters/             (Fase 2 en adelante)
      razo-source/
      github/
      markdown-notifier/
    cli.ts                (Fase 2)
  test/
    signature.test.mjs
    contract.test.mjs     corre cada kit contra su fake y prueba que el kit detecta adaptadores rotos
```

Convenciones del monorepo: tsup, `tsc --noEmit`, `node --test` contra `dist/`, sin dependencias de runtime nuevas.

## 12. Fases

### Fase 1 — Contratos ✅ (completada el 2026-09-24)
- Modelo canónico, interfaces de `ports/`, tipo `TriagePlugin`.
- Kit de tests de contrato por `kind`.
- Adaptadores falsos (in-memory) que pasen el kit.
- **Hecho cuando:** los tests de contrato corren en CI y los adaptadores falsos los pasan.

Desviaciones respecto del diseño original, con su motivo:

1. **La firma la calcula el core.** `core/signature.ts` exporta `errorSignature(message)` y el kit de `ResultSource` verifica que cada `TestError.signature` sea igual a `errorSignature(message)`. Si cada fuente normalizara distinto, los clusters no cruzarían fuentes. La normalización colapsa sólo ruido generado por máquinas: timestamps ISO, UUIDs, ids hexadecimales o numéricos de 8+ caracteres y puertos después de un host. Los valores entre comillas, los nombres de controles y los números cortos de aserción se conservan: dos fallas que difieren en eso son dos causas distintas.
2. **`CodeContext.changedFiles` devuelve `ChangedFile[]`, no `string[]`.** Sin el patch, `core/suspects.ts` no puede buscar agujas y no habría equivalente a `matchControlsToDiff`, que vive en razo-cloud y el core no puede importar.
3. **`configSchema` es estructural.** `{ parse(input: unknown): Config }` en vez de `ZodSchema`. Un esquema zod lo satisface sin cambios y el core no arrastra zod, que no es dependencia de ningún paquete del repo.
4. **`Cluster.id` es `clusterIdOf(signature)`**, SHA-1 truncado a 12 caracteres hexadecimales, en el mismo módulo que la firma. El diseño decía "hash de signature" sin definirlo.

### Fase 2 — MVP local
- Adaptador `razo-source`, adaptador `github`, notificador `markdown`.
- `cluster`, `classify` y `suspects` con tests basados en fixtures reales de Playwright.
- CLI `triage run` que genera el reporte en Markdown.
- **Hecho cuando:** el reporte se genera sobre una corrida nocturna real y las categorías coinciden con el criterio manual en la mayoría de los clusters.

### Fase 3 — Memoria y notificación
- Puerto `TriageStore`, su kit de contrato y el adaptador `sqlite`; estados de cluster, novedad y días abiertos.
- Diagnóstico LLM con regla de credibilidad.
- Notificador Slack.
- **Hecho cuando:** dos días consecutivos no repiten como "nuevo" un cluster ya visto.

### Fase 4 — Tracker con aprobación
- Adaptador Jira: búsqueda por firma, borradores, creación y comentario tras aprobación.
- **Hecho cuando:** no existe ningún camino de código que escriba en el tracker sin una acción aprobada registrada en `triage_actions`.

### Fase 5 — SDK público
- Documentación del contrato de plugins y plugin plantilla.
- Segundo tracker (Linear o GitHub Issues) implementado solo contra la interfaz.
- **Hecho cuando:** el segundo tracker funciona sin cambios en `core/`.

## 13. Métricas

- Tiempo diario dedicado al triage.
- Porcentaje de veredictos aceptados sin cambio.
- Tasa de falsas regresiones (clusters `regression` que resultaron no serlo). Es la métrica principal de credibilidad.
- Costo de LLM por corrida.

## 14. Decisiones abiertas

- Cómo se ejecutan las acciones aprobadas desde Slack (endpoint propio, razo cloud o GitHub Action con `workflow_dispatch`).
- Cuándo agregar el adaptador `postgres` de `TriageStore`: sólo tiene sentido si el triage pasa a ejecutarse dentro de razo-cloud.
- Criterio para extraer el triage como producto independiente de razo.