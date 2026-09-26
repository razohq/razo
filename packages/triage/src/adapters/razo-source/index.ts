import type { TestRun } from '../../core/model';
import type { ConfigSchema, TriagePlugin } from '../../ports/plugin';
import type { ResultSource } from '../../ports/result-source';
import { readRuns } from './layout';
import { toTestRun } from './map';

/**
 * ResultSource over the local layout `<dataDir>/runs/<runId>/{run.json,reports/**}`.
 * Pure reader: collectors (`triage pull`) fill the directory.
 */
export class RazoSource implements ResultSource {
  constructor(private readonly dataDir: string) {}

  async fetchRuns(since: Date): Promise<TestRun[]> {
    return readRuns(this.dataDir)
      .map(({ manifest, reports }) => toTestRun(manifest, reports))
      .filter((run) => Date.parse(run.finishedAt) >= since.getTime())
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
}

export interface RazoSourceConfig {
  dataDir: string;
}

const configSchema: ConfigSchema<RazoSourceConfig> = {
  parse(input: unknown): RazoSourceConfig {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new Error('razo-source config must be an object');
    }
    const { dataDir } = input as Record<string, unknown>;
    if (typeof dataDir !== 'string' || dataDir.length === 0) {
      throw new Error('razo-source config needs a non-empty "dataDir"');
    }
    return { dataDir };
  },
};

export const razoSourcePlugin: TriagePlugin<'source', RazoSourceConfig> = {
  name: 'razo-source',
  kind: 'source',
  configSchema,
  create: (config) => new RazoSource(config.dataDir),
};

export {
  readRuns, writeRun,
  type RunManifest, type RazoReport, type RazoStep, type StoredReport, type StoredRun,
} from './layout';
export { toTestRun, SOURCE_NAME } from './map';
