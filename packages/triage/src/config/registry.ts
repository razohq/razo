import { commitsJsonCodePlugin } from '../adapters/commits-json';
import { githubCodePlugin } from '../adapters/github';
import { markdownNotifierPlugin } from '../adapters/markdown-notifier';
import { razoSourcePlugin } from '../adapters/razo-source';
import type { CodeContext } from '../ports/code-context';
import type { Notifier } from '../ports/notifier';
import type { AdapterOf, PluginKind, TriagePlugin } from '../ports/plugin';
import type { ResultSource } from '../ports/result-source';
import type { PluginRef, TriageConfig } from './schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPlugin = TriagePlugin<PluginKind, any>;

export const builtinPlugins: AnyPlugin[] = [
  razoSourcePlugin, githubCodePlugin, commitsJsonCodePlugin, markdownNotifierPlugin,
];

export interface Adapters {
  source: ResultSource;
  code: CodeContext;
  notifiers: Notifier[];
}

function build<K extends PluginKind>(ref: PluginRef, kind: K, plugins: AnyPlugin[], at: string): AdapterOf[K] {
  const plugin = plugins.find((p) => p.name === ref.plugin);
  if (!plugin) throw new Error(`${at}: unknown plugin "${ref.plugin}" (known: ${plugins.map((p) => p.name).join(', ')})`);
  if (plugin.kind !== kind) throw new Error(`${at}: plugin "${ref.plugin}" is a ${plugin.kind} plugin, not a ${kind} one`);
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
  };
}
