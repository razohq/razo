import { DEFAULT_RULES, type RulesConfig } from '../core/classify';

export interface PluginRef {
  plugin: string;
  enabled?: boolean;
  config?: unknown;
}

export interface PullConfig {
  repo: string;
  token: string;
  workflow?: string;
  branch?: string;
  artifactPrefix?: string;
}

export interface TriageConfig {
  baseBranch: string;
  source: PluginRef;
  code: PluginRef;
  notifiers: PluginRef[];
  pull?: PullConfig;
  rules: RulesConfig;
}

type Env = Record<string, string | undefined>;

/** Replaces every `${VAR}` with its environment value; an unset VAR is an error, never an empty string. */
function expand(value: unknown, env: Env, at: string): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => {
      const found = env[name];
      if (found === undefined) throw new Error(`${at}: environment variable ${name} is not set`);
      return found;
    });
  }
  if (Array.isArray(value)) return value.map((v, i) => expand(v, env, `${at}[${i}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, env, `${at}.${k}`)]));
  }
  return value;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function pluginRef(value: unknown, at: string): PluginRef {
  if (!isObject(value) || typeof value.plugin !== 'string' || value.plugin.length === 0) {
    throw new Error(`${at}: expected { plugin: <name>, config?: {...} }`);
  }
  const ref: PluginRef = { plugin: value.plugin };
  if (value.enabled !== undefined) ref.enabled = Boolean(value.enabled);
  if (value.config !== undefined) ref.config = value.config;
  return ref;
}

function mergeRules(value: unknown): RulesConfig {
  if (value === undefined) return structuredClone(DEFAULT_RULES);
  if (!isObject(value)) throw new Error('rules: expected an object');
  const out = structuredClone(DEFAULT_RULES) as unknown as Record<string, Record<string, number>>;
  for (const [group, fields] of Object.entries(value)) {
    if (!(group in out)) throw new Error(`rules.${group}: unknown group`);
    if (!isObject(fields)) throw new Error(`rules.${group}: expected an object`);
    for (const [key, n] of Object.entries(fields)) {
      if (!(key in out[group]) || typeof n !== 'number') throw new Error(`rules.${group}.${key}: expected a known threshold with a number`);
      out[group][key] = n;
    }
  }
  return out as unknown as RulesConfig;
}

export function parseConfig(raw: unknown, env: Env = process.env): TriageConfig {
  if (!isObject(raw)) throw new Error('config: expected an object');
  const cfg = expand(raw, env, 'config') as Record<string, unknown>;
  if (cfg.source === undefined) throw new Error('config: "source" is required');
  if (cfg.code === undefined) throw new Error('config: "code" is required');
  if (cfg.notifiers !== undefined && !Array.isArray(cfg.notifiers)) throw new Error('config: "notifiers" must be a list');
  const out: TriageConfig = {
    baseBranch: typeof cfg.baseBranch === 'string' && cfg.baseBranch ? cfg.baseBranch : 'main',
    source: pluginRef(cfg.source, 'source'),
    code: pluginRef(cfg.code, 'code'),
    notifiers: ((cfg.notifiers as unknown[] | undefined) ?? []).map((n, i) => pluginRef(n, `notifiers[${i}]`)),
    rules: mergeRules(cfg.rules),
  };
  if (cfg.pull !== undefined) {
    if (!isObject(cfg.pull) || typeof cfg.pull.repo !== 'string' || typeof cfg.pull.token !== 'string') {
      throw new Error('pull: expected { repo, token, workflow?, branch?, artifactPrefix? }');
    }
    out.pull = { repo: cfg.pull.repo, token: cfg.pull.token };
    for (const key of ['workflow', 'branch', 'artifactPrefix'] as const) {
      if (typeof cfg.pull[key] === 'string') out.pull[key] = cfg.pull[key] as string;
    }
  }
  return out;
}
