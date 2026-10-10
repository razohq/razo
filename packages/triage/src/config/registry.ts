import { commitsJsonCodePlugin } from '../adapters/commits-json';
import { githubCodePlugin, githubTrackerPlugin } from '../adapters/github';
import { jsonFileStorePlugin } from '../adapters/json-store';
import { markdownNotifierPlugin } from '../adapters/markdown-notifier';
import { httpNotifierPlugin } from '../adapters/http-notifier';
import { razoSourcePlugin } from '../adapters/razo-source';
import type { CodeContext } from '../ports/code-context';
import type { IssueTracker } from '../ports/issue-tracker';
import type { Notifier } from '../ports/notifier';
import type { AdapterOf, PluginKind, TriagePlugin } from '../ports/plugin';
import type { ResultSource } from '../ports/result-source';
import type { TriageStore } from '../ports/store';
import type { PluginRef, TriageConfig } from './schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPlugin = TriagePlugin<PluginKind, any>;

export const builtinPlugins: AnyPlugin[] = [
  razoSourcePlugin, githubCodePlugin, commitsJsonCodePlugin, markdownNotifierPlugin, httpNotifierPlugin, jsonFileStorePlugin,
  githubTrackerPlugin,
];

export interface Adapters {
  source: ResultSource;
  code: CodeContext;
  notifiers: Notifier[];
  store?: TriageStore;
  tracker?: IssueTracker;
  /** The tracker plugin's name, which its IssueRefs carry. */
  trackerName?: string;
}

/** Looks a plugin up by kind and name: two kinds may share a name (a `github` code adapter and a `github` tracker). */
function build<K extends PluginKind>(ref: PluginRef, kind: K, plugins: AnyPlugin[], at: string): AdapterOf[K] {
  const plugin = plugins.find((p) => p.kind === kind && p.name === ref.plugin);
  if (!plugin) {
    const otherKinds = plugins.filter((p) => p.name === ref.plugin).map((p) => p.kind);
    const known = plugins.filter((p) => p.kind === kind).map((p) => p.name).join(', ');
    throw new Error(
      otherKinds.length > 0
        ? `${at}: no ${kind} plugin named "${ref.plugin}" (it is a ${otherKinds.join('/')} plugin); known ${kind} plugins: ${known}`
        : `${at}: unknown plugin "${ref.plugin}"; known ${kind} plugins: ${known}`,
    );
  }
  return plugin.create(plugin.configSchema.parse(ref.config ?? {})) as AdapterOf[K];
}

/** Turns the config's plugin references into adapters. A disabled notifier is never parsed nor built. */
export function instantiate(config: TriageConfig, plugins: AnyPlugin[] = builtinPlugins): Adapters {
  return {
    source: build(config.source, 'source', plugins, 'source'),
    code: build(config.code, 'code', plugins, 'code'),
    notifiers: config.notifiers
      .filter((n) => n.enabled !== false)
      .map((n, i) => build(n, 'notifier', plugins, `notifiers[${i}]`)),
    ...(config.store ? { store: build(config.store, 'store', plugins, 'store') } : {}),
    ...(config.tracker
      ? { tracker: build(config.tracker, 'tracker', plugins, 'tracker'), trackerName: config.tracker.plugin }
      : {}),
  };
}
