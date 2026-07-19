import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUploadPayload } from '../dist/index.js';

const report = { test: 't', file: 'f', status: 'failed', durationMs: 1, steps: [] };

test('buildUploadPayload reads GitHub Actions metadata', () => {
  const payload = buildUploadPayload([report], {
    GITHUB_REF_NAME: 'main',
    GITHUB_SHA: 'abc123',
    GITHUB_REF: 'refs/pull/42/merge',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_RUN_ID: '99',
  });
  assert.equal(payload.run.branch, 'main');
  assert.equal(payload.run.commitSha, 'abc123');
  assert.equal(payload.run.prNumber, 42);
  assert.equal(payload.run.ciUrl, 'https://github.com/owner/repo/actions/runs/99');
  assert.equal(payload.reports.length, 1);
});

test('buildUploadPayload works with an empty environment', () => {
  const payload = buildUploadPayload([report], {});
  assert.deepEqual(payload.run, {});
  assert.equal(payload.reports.length, 1);
});
