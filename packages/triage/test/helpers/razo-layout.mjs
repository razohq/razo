import * as fs from 'node:fs';
import * as path from 'node:path';

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const kebab = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** `button "Place order"` → { controlType: 'button', name: 'Place order' } */
function parseComponent(component) {
  const m = component.match(/^(.+?) "(.*)"$/);
  return m ? { controlType: m[1], name: m[2] } : { controlType: 'control', name: component };
}

/**
 * Inverse of razo-source's mapping, for tests only: writes TestRuns as the
 * razo-steps.json layout so the contract kit can run against RazoSource.
 * Each attempt becomes one report in a `-retryN` directory; a failing
 * attempt gets one failed step carrying the attempt's error so the error
 * text (and therefore its signature) round-trips.
 */
export function writeSeedLayout(dir, runs) {
  for (const run of runs) {
    const runDir = path.join(dir, 'runs', run.id);
    fs.mkdirSync(path.join(runDir, 'reports'), { recursive: true });
    const { results, source: _source, ...manifest } = run;
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(manifest, null, 2));
    for (const result of results) {
      const controls = (result.controls ?? (result.touchedComponents ?? []).map(parseComponent)).map((c) => ({
        controlType: c.controlType, name: c.name,
        selector: c.selector ?? `[data-testid="${kebab(c.name)}"]`,
      }));
      result.attempts.forEach((attempt, retry) => {
        const steps = controls.map((c) => ({
          action: 'click', controlType: c.controlType, name: c.name,
          sentence: `Click ${c.controlType} "${c.name}"`, selector: c.selector,
          status: 'passed', timestamp: run.startedAt,
        }));
        if (attempt.error) {
          if (steps.length === 0) {
            steps.push({
              action: 'click', controlType: 'control', name: 'unknown', sentence: 'Click control "unknown"',
              selector: '-', status: 'passed', timestamp: run.startedAt,
            });
          }
          const last = steps[steps.length - 1];
          last.status = 'failed';
          last.error = attempt.error.message;
        }
        const report = {
          test: result.title, file: result.file, status: attempt.status,
          durationMs: attempt.durationMs, error: attempt.error?.message, steps,
        };
        if (result.project) report.project = result.project;
        const base = `${slug(path.basename(result.file).replace(/\.(spec|test)\.[cm]?[jt]s$/, ''))}-${slug(result.title)}`;
        const reportDir = path.join(runDir, 'reports', retry > 0 ? `${base}-retry${retry}` : base);
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(path.join(reportDir, 'razo-steps.json'), JSON.stringify(report, null, 2));
      });
    }
  }
}
