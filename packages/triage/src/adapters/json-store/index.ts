import * as fs from 'fs';
import * as path from 'path';
import type { Cluster, TriageAction, TriageRunRecord } from '../../core/model';
import type { ConfigSchema, TriagePlugin } from '../../ports/plugin';
import type { TriageStore } from '../../ports/store';

/** Bump when the file's shape changes; a file with another version is refused, never guessed at. */
export const STATE_SCHEMA_VERSION = 1;

interface State {
  schemaVersion: number;
  clusters: Cluster[];
  runs: TriageRunRecord[];
  actions: TriageAction[];
}

const empty = (): State => ({ schemaVersion: STATE_SCHEMA_VERSION, clusters: [], runs: [], actions: [] });

/**
 * TriageStore over one JSON file. No dependencies, works on Node 20, and
 * fits the CI persistence strategy: the file is uploaded as an artifact
 * after `triage run` and restored by `triage pull` before the next one.
 * Every write is atomic (temporary file, then rename) so a crash never
 * leaves a half-written state behind.
 */
export class JsonFileStore implements TriageStore {
  constructor(private readonly file: string) {}

  private read(): State {
    if (!fs.existsSync(this.file)) return empty();
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      throw new Error(`${this.file}: cannot read triage state (${error instanceof Error ? error.message : String(error)})`);
    }
    const state = parsed as Partial<State> | null;
    if (typeof state !== 'object' || state === null || state.schemaVersion !== STATE_SCHEMA_VERSION) {
      throw new Error(
        `${this.file}: unknown triage state schema version ${JSON.stringify(state?.schemaVersion)} (this build reads version ${STATE_SCHEMA_VERSION})`,
      );
    }
    return { schemaVersion: STATE_SCHEMA_VERSION, clusters: state.clusters ?? [], runs: state.runs ?? [], actions: state.actions ?? [] };
  }

  private write(state: State): void {
    const json = JSON.stringify(state, null, 2) + '\n'; // throws before anything touches the disk
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, this.file);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw error;
    }
  }

  private update(change: (state: State) => void): void {
    const state = this.read();
    change(state);
    this.write(state);
  }

  async lastTriageAt(): Promise<Date | null> {
    const { runs } = this.read();
    if (runs.length === 0) return null;
    return new Date(runs.reduce((a, b) => (a.generatedAt >= b.generatedAt ? a : b)).generatedAt);
  }

  async loadClusters(): Promise<Cluster[]> {
    return this.read().clusters;
  }

  async saveClusters(clusters: Cluster[]): Promise<void> {
    this.update((state) => { state.clusters = clusters; });
  }

  async recordRun(run: TriageRunRecord): Promise<void> {
    this.update((state) => { state.runs.push(run); });
  }

  async recordAction(action: TriageAction): Promise<void> {
    this.update((state) => { state.actions.push(action); });
  }

  async actionsFor(clusterId: string): Promise<TriageAction[]> {
    return this.read().actions.filter((a) => a.clusterId === clusterId);
  }
}

export interface JsonFileStoreConfig {
  path: string;
}

const configSchema: ConfigSchema<JsonFileStoreConfig> = {
  parse(input: unknown): JsonFileStoreConfig {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('json-file store config must be an object');
    const { path: file } = input as Record<string, unknown>;
    if (typeof file !== 'string' || file.length === 0) throw new Error('json-file store config needs a non-empty "path"');
    return { path: file };
  },
};

export const jsonFileStorePlugin: TriagePlugin<'store', JsonFileStoreConfig> = {
  name: 'json-file',
  kind: 'store',
  configSchema,
  create: (config) => new JsonFileStore(config.path),
};
