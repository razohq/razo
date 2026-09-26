import type { Cluster, TriageAction, TriageRunRecord } from '../core/model';
import { SIGNATURE_ALGORITHM_VERSION } from '../core/signature';
import type { TriageStore } from '../ports/store';

/** In-memory TriageStore: the reference implementation of the contract. */
export class MemoryStore implements TriageStore {
  private clusters: Cluster[] = [];
  private runs: TriageRunRecord[] = [];
  private actions: TriageAction[] = [];
  private version: number | null = null;

  async signatureVersion(): Promise<number | null> {
    return this.version;
  }

  async lastTriageAt(): Promise<Date | null> {
    if (this.runs.length === 0) return null;
    const latest = this.runs.reduce((a, b) => (a.generatedAt >= b.generatedAt ? a : b));
    return new Date(latest.generatedAt);
  }

  async loadClusters(): Promise<Cluster[]> {
    return structuredClone(this.clusters);
  }

  async saveClusters(clusters: Cluster[]): Promise<void> {
    this.clusters = structuredClone(clusters);
    this.version = SIGNATURE_ALGORITHM_VERSION;
  }

  async recordRun(run: TriageRunRecord): Promise<void> {
    this.runs.push(structuredClone(run));
    this.version = SIGNATURE_ALGORITHM_VERSION;
  }

  async recordAction(action: TriageAction): Promise<void> {
    this.actions.push(structuredClone(action));
    this.version = SIGNATURE_ALGORITHM_VERSION;
  }

  async actionsFor(clusterId: string): Promise<TriageAction[]> {
    return structuredClone(this.actions.filter((a) => a.clusterId === clusterId));
  }
}
