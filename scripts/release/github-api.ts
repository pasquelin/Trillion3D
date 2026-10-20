// The one REST call helper of the CI scripts: Node's own `fetch`, the same bearer headers, a path
// below `https://api.github.com/repos/<repo>/`. It throws unless 2xx. Shared so no script keeps a
// second copy of the header block (jscpd, AGENTS.md rule 7).
// Usage: const api = githubApi(repo, token); const issue = await api<Issue>('issues/1');
/** A call to the repository's REST API, `path` below `/repos/<repo>/`; throws unless 2xx. */
export function githubApi(repo: string, token: string) {
  return async <T = unknown>(path: string, method = 'GET', payload?: object): Promise<T> => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      body: payload && JSON.stringify(payload),
    })
    if (!response.ok)
      throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
    return response.json() as Promise<T>
  }
}
