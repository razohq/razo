import * as fs from 'fs';

const COMMENT_MARKER = '<!-- razo-analyzer -->';

/**
 * Posts (or updates) the analysis as a PR comment. Designed for GitHub
 * Actions: reads GITHUB_TOKEN, GITHUB_REPOSITORY and the PR number from the
 * event payload. Re-runs update the existing comment instead of stacking.
 */
export async function upsertPrComment(markdown: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repository) {
    throw new Error('--pr-comment requires GITHUB_TOKEN and GITHUB_REPOSITORY (GitHub Actions).');
  }
  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error('--pr-comment requires GITHUB_EVENT_PATH with a pull_request event payload.');
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const prNumber: number | undefined = event.pull_request?.number ?? event.issue?.number;
  if (!prNumber) {
    throw new Error('Could not determine the pull request number from the event payload.');
  }

  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed: ${response.status}`);
    }
    return response.json();
  };

  const body = `${COMMENT_MARKER}\n## 🤖 razo failure analysis\n\n${markdown}`;
  const comments = (await api(`/repos/${repository}/issues/${prNumber}/comments?per_page=100`)) as Array<{
    id: number;
    body?: string;
  }>;
  const existing = comments.find((comment) => comment.body?.startsWith(COMMENT_MARKER));

  if (existing) {
    await api(`/repos/${repository}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  } else {
    await api(`/repos/${repository}/issues/${prNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }
}
