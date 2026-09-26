import type { Cluster, TriageAction, TriageRunRecord } from '../core/model';
import type { TriageStore } from '../ports/store';

/** In-memory TriageStore: the reference implementation of the contract. */
export class MemoryStore implements TriageStore {
  private clusters: Cluster[] = [];
  private runs: TriageRunRecord[] = [];
  private actions: TriageAction[] = [];

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
  }

  async recordRun(run: TriageRunRecord): Promise<void> {
    this.runs.push(structuredClone(run));
  }

  async recordAction(action: TriageAction): Promise<void> {
    this.actions.push(structuredClone(action));
  }

  async actionsFor(clusterId: string): Promise<TriageAction[]> {
    return structuredClone(this.actions.filter((a) => a.clusterId === clusterId));
  }
}
