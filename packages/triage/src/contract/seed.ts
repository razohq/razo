import type { ChangedFile, Commit, IssueRef, TestRun, TriageReport } from '../core/model';
import { clusterIdOf, errorSignature } from '../core/signature';

/**
 * The fixture every contract kit hands to an adapter factory. Adapters load
 * it however they store data (an array, temp files, a fake API) and the kit
 * checks the same facts come back out.
 */
export interface Seed {
  /** Chronological. `files` is what `changedFiles(sha)` must return. */
  commits: Array<Commit & { files: ChangedFile[] }>;
  /** Ascending by `startedAt`, across the seeded commits. */
  runs: TestRun[];
  /** Issues that already exist in the tracker, keyed by failure signature. */
  issues: Array<{ signature: string; ref: IssueRef }>;
  report: TriageReport;
}

const GREEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const MID = 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1';
const RED = 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2';

const NOT_FOUND = 'Error: locator "button[name=Place order]" not found after 5000ms';
const TIMEOUT = 'TimeoutError: page.goto: Timeout 30000ms exceeded navigating to http://localhost:3000/';

const err = (message: string) => ({ message, signature: errorSignature(message) });

const passed = (testId: string, file: string, title: string, durationMs = 900) => ({
  testId, file, title, status: 'passed' as const, durationMs,
  attempts: [{ status: 'passed' as const, durationMs }],
});

export const seed: Seed = {
  commits: [
    {
      sha: GREEN, message: 'Checkout: add order summary', author: 'ana', date: '2026-09-22T09:00:00Z',
      files: [{ filename: 'src/checkout/Summary.tsx', patch: '+ <OrderSummary />' }],
    },
    {
      sha: MID, message: 'Checkout: hide Place order until the cart is priced', author: 'ana',
      date: '2026-09-23T10:00:00Z',
      files: [
        { filename: 'src/checkout/PlaceOrder.tsx', patch: '- <button>Place order</button>\n+ {priced && <button>Place order</button>}' },
      ],
    },
    {
      sha: RED, message: 'Cart: remove the Mouse sample row', author: 'luis', date: '2026-09-23T15:00:00Z',
      files: [{ filename: 'src/cart/rows.ts', patch: "- { name: 'Mouse' }," }],
    },
  ],
  runs: [
    {
      id: 'run-1', sha: GREEN, branch: 'main', source: 'seed',
      startedAt: '2026-09-22T22:00:00Z', finishedAt: '2026-09-22T22:05:00Z',
      results: [
        passed('tests/checkout.spec.ts::placing the order confirms it', 'tests/checkout.spec.ts', 'placing the order confirms it'),
        passed('tests/cart.spec.ts::the cart lists both items', 'tests/cart.spec.ts', 'the cart lists both items'),
      ],
    },
    {
      id: 'run-2', sha: RED, branch: 'main', source: 'seed',
      startedAt: '2026-09-23T22:00:00Z', finishedAt: '2026-09-23T22:06:00Z',
      results: [
        {
          testId: 'tests/checkout.spec.ts::placing the order confirms it',
          file: 'tests/checkout.spec.ts', title: 'placing the order confirms it',
          status: 'failed', durationMs: 5400,
          attempts: [
            { status: 'failed', durationMs: 5300, error: err(NOT_FOUND) },
            { status: 'failed', durationMs: 5400, error: err(NOT_FOUND) },
          ],
          error: err(NOT_FOUND),
          touchedComponents: ['field "Email"', 'button "Place order"'],
        },
        {
          testId: 'tests/cart.spec.ts::the cart lists both items',
          file: 'tests/cart.spec.ts', title: 'the cart lists both items',
          status: 'passed', durationMs: 1200,
          attempts: [
            { status: 'failed', durationMs: 31000, error: err(TIMEOUT) },
            { status: 'passed', durationMs: 1200 },
          ],
          touchedComponents: ['table "Cart"'],
        },
      ],
    },
    {
      id: 'run-3', sha: RED, branch: 'main', source: 'seed',
      startedAt: '2026-09-24T06:00:00Z', finishedAt: '2026-09-24T06:04:00Z',
      results: [
        {
          testId: 'tests/checkout.spec.ts::placing the order confirms it',
          file: 'tests/checkout.spec.ts', title: 'placing the order confirms it',
          status: 'failed', durationMs: 5200,
          attempts: [{ status: 'failed', durationMs: 5200, error: err(NOT_FOUND) }],
          error: err(NOT_FOUND),
          touchedComponents: ['field "Email"', 'button "Place order"'],
        },
        passed('tests/cart.spec.ts::the cart lists both items', 'tests/cart.spec.ts', 'the cart lists both items', 1100),
      ],
    },
  ],
  issues: [
    {
      signature: errorSignature(NOT_FOUND),
      ref: { tracker: 'seed', key: 'QA-101', url: 'https://tracker.example/QA-101', status: 'open' },
    },
  ],
  report: {
    generatedAt: '2026-09-24T07:00:00Z',
    window: { from: '2026-09-23T07:00:00Z', to: '2026-09-24T07:00:00Z' },
    totals: { tests: 2, failures: 2, clusters: 1 },
    items: [
      {
        cluster: {
          id: clusterIdOf(errorSignature(NOT_FOUND)),
          signature: errorSignature(NOT_FOUND),
          failures: [
            { runId: 'run-2', testId: 'tests/checkout.spec.ts::placing the order confirms it', sha: RED },
            { runId: 'run-3', testId: 'tests/checkout.spec.ts::placing the order confirms it', sha: RED },
          ],
          category: 'stale-test', confidence: 'medium', novelty: 'new',
          firstSeenAt: '2026-09-23T22:06:00Z', lastSeenAt: '2026-09-24T06:04:00Z',
          lastGreenSha: GREEN, firstRedSha: RED,
          suspectCommits: [
            { sha: MID, message: 'Checkout: hide Place order until the cart is priced', author: 'ana', overlappingComponents: ['button "Place order"'], score: 1 },
          ],
          state: 'new',
        },
        verdict: {
          clusterId: clusterIdOf(errorSignature(NOT_FOUND)),
          category: 'stale-test', confidence: 'medium',
          summary: 'The Place order button is hidden until pricing; the test asserts the old UI.',
          nextStep: 'Update the test to price the cart before placing the order.',
          evidence: [
            { kind: 'sha-range', description: `${GREEN.slice(0, 7)}..${RED.slice(0, 7)}` },
            { kind: 'commit', description: `${MID.slice(0, 7)} touches button "Place order"` },
          ],
          origin: 'rules',
        },
        proposedActions: [{ type: 'comment-issue', issue: { tracker: 'seed', key: 'QA-101', url: 'https://tracker.example/QA-101', status: 'open' }, body: 'Seen again in run-3.' }],
      },
    ],
  },
};
