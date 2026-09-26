import type { CodeContext } from './code-context';
import type { IssueTracker } from './issue-tracker';
import type { Notifier } from './notifier';
import type { ResultSource } from './result-source';
import type { TriageStore } from './store';

export type PluginKind = 'source' | 'code' | 'tracker' | 'notifier' | 'store';

export interface AdapterOf {
  source: ResultSource;
  code: CodeContext;
  tracker: IssueTracker;
  notifier: Notifier;
  store: TriageStore;
}

/**
 * Structural schema: anything with a throwing `parse` fits, a zod schema
 * included, without making zod a dependency of the core.
 */
export interface ConfigSchema<Config> {
  parse(input: unknown): Config;
}

export interface TriagePlugin<Kind extends PluginKind = PluginKind, Config = unknown> {
  /** kebab-case, e.g. 'jira'. External packages are named triage-plugin-<name>. */
  name: string;
  kind: Kind;
  configSchema: ConfigSchema<Config>;
  create(config: Config): AdapterOf[Kind];
}
