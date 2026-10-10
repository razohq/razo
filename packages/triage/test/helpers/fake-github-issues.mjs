import { issueMarker } from '../../dist/index.js';

const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });

/**
 * A fake GitHub holding issues of repo o/r: search (a loose text match, like
 * GitHub's), create and comment. Search indexes instantly here; on GitHub a new
 * issue takes a few minutes, which a once-a-morning lookup never notices.
 */
export function fakeIssues(seeded = []) {
  const issues = seeded.map((s, i) => ({
    number: i + 1, title: 'seeded', state: s.ref.status === 'closed' ? 'closed' : 'open',
    body: `Seen in the nightly.\n\n${issueMarker(s.signature)}`, html_url: `https://github.com/o/r/issues/${i + 1}`,
  }));
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? 'GET', path: u.pathname, q: u.searchParams.get('q'), body: init.body });
    if (u.pathname === '/search/issues') {
      const q = u.searchParams.get('q') ?? '';
      if (!q.includes('repo:o/r') || !q.includes('is:issue')) return json(422, { message: 'unscoped search' });
      const phrase = q.match(/"([^"]+)"/)?.[1] ?? '';
      const words = phrase.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const items = issues.filter((i) => words.every((w) => i.body.toLowerCase().includes(w)));
      return json(200, { total_count: items.length, items });
    }
    if (u.pathname === '/repos/o/r/issues' && init.method === 'POST') {
      const { title, body } = JSON.parse(init.body);
      const issue = { number: issues.length + 1, title, body, state: 'open', html_url: `https://github.com/o/r/issues/${issues.length + 1}` };
      issues.push(issue);
      return json(201, issue);
    }
    const comment = u.pathname.match(/^\/repos\/o\/r\/issues\/(\d+)\/comments$/);
    if (comment && init.method === 'POST') {
      return issues.some((i) => i.number === Number(comment[1])) ? json(201, { id: 1 }) : json(404, { message: 'Not Found' });
    }
    return json(404, { message: 'Not Found' });
  };
  return { fetch, issues, calls };
}

