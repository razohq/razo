export * from './core/model';
export { errorSignature, clusterIdOf } from './core/signature';
export type { ResultSource } from './ports/result-source';
export type { CodeContext } from './ports/code-context';
export type { IssueTracker } from './ports/issue-tracker';
export type { Notifier } from './ports/notifier';
export type { AdapterOf, ConfigSchema, PluginKind, TriagePlugin } from './ports/plugin';
export { clusterFailures, failingTestIds } from './core/cluster';
export {
  testHistories, shaRange, stableBefore, retryFlip, sameShaFlips, isFailing, DEFAULT_BASE_BRANCH,
  type TestHistory, type TestOutcome, type HistoryOptions,
} from './core/history';
export {
  needlesFor, changedLines, findSuspects, commitsInRange,
  type SuspectInput, type SuspectSearch, type UnevaluableFile,
} from './core/suspects';
export {
  RazoSource, razoSourcePlugin, readRuns, writeRun, toTestRun, SOURCE_NAME,
  type RazoSourceConfig, type RunManifest, type RazoReport, type RazoStep, type StoredReport, type StoredRun,
} from './adapters/razo-source';
