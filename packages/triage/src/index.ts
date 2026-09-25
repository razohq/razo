export * from './core/model';
export { errorSignature, clusterIdOf } from './core/signature';
export type { ResultSource } from './ports/result-source';
export type { CodeContext } from './ports/code-context';
export type { IssueTracker } from './ports/issue-tracker';
export type { Notifier } from './ports/notifier';
export type { AdapterOf, ConfigSchema, PluginKind, TriagePlugin } from './ports/plugin';
export { clusterFailures, failingTestIds } from './core/cluster';
export {
  testHistories, shaRange, stableBefore, retryFlip, sameShaFlips, isFailing,
  type TestHistory, type TestOutcome,
} from './core/history';
export { needlesFor, changedLines, findSuspects, commitsInRange, type SuspectInput } from './core/suspects';
