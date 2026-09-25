export * from './core/model';
export { errorSignature, clusterIdOf } from './core/signature';
export type { ResultSource } from './ports/result-source';
export type { CodeContext } from './ports/code-context';
export type { IssueTracker } from './ports/issue-tracker';
export type { Notifier } from './ports/notifier';
export type { AdapterOf, ConfigSchema, PluginKind, TriagePlugin } from './ports/plugin';
export { clusterFailures, failingTestIds } from './core/cluster';
export {
  testHistories, shaRange, stableBefore, retryFlip, sameShaFlips, isFailing, onBaseBranch, DEFAULT_BASE_BRANCH,
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
export {
  classify, DEFAULT_RULES, isEnvironmentSignature, isLocatorSignature,
  type Classification, type ClassifyInput, type RulesConfig,
} from './core/classify';
export { analyzeWindow, type TriageItem, type AnalyzeOptions } from './core/pipeline';
export { buildReport, type ReportInput } from './core/report';
export {
  MarkdownNotifier, markdownNotifierPlugin, renderMarkdown, readReports, type MarkdownNotifierConfig,
} from './adapters/markdown-notifier';
export {
  GitHubApi, GitHubApiError, GitHubCodeContext, githubCodePlugin, githubConfigSchema,
  type FetchLike, type FetchResponseLike, type GitHubApiOptions, type GitHubConfig,
} from './adapters/github';
export { CommitsJsonCodeContext, commitsJsonCodePlugin, type CommitsJsonConfig } from './adapters/commits-json';
export { reportsFromZip } from './collectors/unzip';
export { pullGithubArtifacts, DEFAULT_ARTIFACT_PREFIX, type PullOptions, type PullSummary } from './collectors/github-artifacts';
export { parseConfig, type TriageConfig, type PluginRef, type PullConfig } from './config/schema';
export { loadConfig } from './config/load';
export { instantiate, builtinPlugins, type Adapters } from './config/registry';
export { parseDuration, runTriage, runPull, type RunOptions, type RunResult, type PullCommandOptions } from './commands';
