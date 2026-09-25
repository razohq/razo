import type { CodeContext } from '../ports/code-context';
import { classify, DEFAULT_RULES, type Classification, type RulesConfig } from './classify';
import { clusterFailures, failingTestIds } from './cluster';
import { shaRange, testHistories } from './history';
import type { Cluster, TestRun, TouchedControl } from './model';
import { commitsInRange, findSuspects, type UnevaluableFile } from './suspects';

export interface TriageItem {
  cluster: Cluster;
  classification: Classification;
  range: { lastGreenSha?: string; firstRedSha?: string };
  unevaluable: UnevaluableFile[];
}

export interface AnalyzeOptions {
  /** Branch whose runs define green and red. Default: main. */
  baseBranch?: string;
}

/** Controls driven by the cluster's tests, across every run in the window. */
function controlsOf(cluster: Cluster, runs: TestRun[]): TouchedControl[] {
  const ids = new Set(failingTestIds(cluster));
  const seen = new Map<string, TouchedControl>();
  for (const run of runs) {
    for (const result of run.results) {
      if (!ids.has(result.testId)) continue;
      for (const c of result.controls ?? []) seen.set(`${c.controlType}\u0000${c.name}\u0000${c.selector}`, c);
    }
  }
  return [...seen.values()];
}

/** cluster → history → suspects → classify, in dependency order; writes the verdict back onto each cluster. */
export async function analyzeWindow(
  runs: TestRun[],
  code: CodeContext,
  rules: RulesConfig = DEFAULT_RULES,
  options: AnalyzeOptions = {},
): Promise<TriageItem[]> {
  const clusters = clusterFailures(runs);
  const histories = testHistories(runs);
  const items: TriageItem[] = [];
  for (const cluster of clusters) {
    const [firstTest] = failingTestIds(cluster);
    const history = histories.get(firstTest) ?? { testId: firstTest, file: '', outcomes: [] };
    const range = shaRange(history, options);
    const commits = await commitsInRange(code, range);
    const { suspects, unevaluable } = await findSuspects({
      controls: controlsOf(cluster, runs), commits, changedFiles: (sha) => code.changedFiles(sha),
    });
    const classification = classify(
      { cluster, clusters, runs, histories, range, commitsInRange: commits, suspects, unevaluable, baseBranch: options.baseBranch },
      rules,
    );
    cluster.category = classification.category;
    cluster.confidence = classification.confidence;
    cluster.lastGreenSha = range.lastGreenSha;
    cluster.firstRedSha = range.firstRedSha;
    cluster.suspectCommits = suspects;
    items.push({ cluster, classification, range, unevaluable });
  }
  return items;
}
