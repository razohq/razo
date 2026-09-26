import type { Cluster, TriageAction, TriageRunRecord } from '../core/model';

/**
 * The triage's memory. Contract (see contract/store.ts): what is saved is
 * what comes back, `lastTriageAt` is null until the first recorded run and
 * then the latest run's generatedAt, and actions come back in the order
 * they were recorded.
 */
export interface TriageStore {
  lastTriageAt(): Promise<Date | null>;
  loadClusters(): Promise<Cluster[]>;
  saveClusters(clusters: Cluster[]): Promise<void>;
  recordRun(run: TriageRunRecord): Promise<void>;
  recordAction(action: TriageAction): Promise<void>;
  actionsFor(clusterId: string): Promise<TriageAction[]>;
}
