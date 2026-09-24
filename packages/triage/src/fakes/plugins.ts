import type { IssueRef, TestRun } from '../core/model';
import type { ConfigSchema, TriagePlugin } from '../ports/plugin';
import { MemoryCodeContext, type MemoryCommit } from './memory-code';
import { MemoryNotifier } from './memory-notifier';
import { MemoryResultSource } from './memory-source';
import { MemoryIssueTracker } from './memory-tracker';

/** Minimal structural schema: a plain object whose listed keys, when present, are arrays. */
function objectSchema<Config extends object>(arrayKeys: Array<keyof Config & string>): ConfigSchema<Config> {
  return {
    parse(input: unknown): Config {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error(`config must be an object, got ${JSON.stringify(input)}`);
      }
      const record = input as Record<string, unknown>;
      for (const key of arrayKeys) {
        if (key in record && !Array.isArray(record[key])) {
          throw new Error(`config.${key} must be an array`);
        }
      }
      return input as Config;
    },
  };
}

export const memorySourcePlugin: TriagePlugin<'source', { runs?: TestRun[] }> = {
  name: 'memory-source',
  kind: 'source',
  configSchema: objectSchema(['runs']),
  create: (config) => new MemoryResultSource(config.runs ?? []),
};

export const memoryCodePlugin: TriagePlugin<'code', { commits?: MemoryCommit[] }> = {
  name: 'memory-code',
  kind: 'code',
  configSchema: objectSchema(['commits']),
  create: (config) => new MemoryCodeContext(config.commits ?? []),
};

export const memoryTrackerPlugin: TriagePlugin<
  'tracker',
  { issues?: Array<{ signature: string; ref: IssueRef }> }
> = {
  name: 'memory-tracker',
  kind: 'tracker',
  configSchema: objectSchema(['issues']),
  create: (config) => new MemoryIssueTracker('memory-tracker', config.issues ?? []),
};

export const memoryNotifierPlugin: TriagePlugin<'notifier', Record<string, never>> = {
  name: 'memory-notifier',
  kind: 'notifier',
  configSchema: objectSchema([]),
  create: () => new MemoryNotifier(),
};
