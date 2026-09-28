// Closes, as completed, every issue a pull request merged into develop names with a closing
// keyword: GitHub does it only on a merge into the default branch (`main`). Each issue gets a
// comment linking the pull request; an issue already closed is skipped. It talks to the REST API
// with Node's own `fetch`, so the workflow needs no dependency and no CLI.
// Usage (CI): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo PR_URL=… PR_BODY=… node scripts/close-named-issues.ts
import { pathToFileURL } from 'node:url';

// GitHub's closing keywords, then `#n` of this repository (an `owner/repo#n` does not match).
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;

/** The issue numbers the body closes, once each, in order; code and HTML comments are ignored. */
export function namedIssues(body: string): number[] {
  const prose = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
    .replace(/`[^`\n]*`/g, '');
  return [...new Set([...prose.matchAll(CLOSING)].map((match) => Number(match[1])))];
}

async function main(env: NodeJS.ProcessEnv): Promise<void> {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_URL: url } = env;
  if (!token || !repo || !url) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_URL are required.');
  const api = async (path: string, method = 'GET', payload?: object) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues/${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      body: payload && JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<{ state: string; pull_request?: object }>;
  };
  for (const issue of namedIssues(env.PR_BODY ?? '')) {
    const current = await api(`${issue}`);
    if (current.pull_request || current.state === 'closed') {
      console.log(`#${issue}: skipped (${current.pull_request ? 'a pull request' : 'already closed'}).`);
      continue;
    }
    await api(`${issue}/comments`, 'POST', { body: `Closed by ${url} (merged into develop).` });
    await api(`${issue}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
    console.log(`#${issue}: closed.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.env);
}
