// Closes, as completed, every issue a pull request merged into develop names with a closing
// keyword: GitHub does it only on a merge into the default branch (`main`). Each issue gets a
// comment linking the pull request; an issue already closed is skipped. It talks to the REST API
// with Node's own `fetch`, so the workflow needs no dependency and no CLI.
// Usage (CI): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo PR_URL=… PR_BODY=… node scripts/close-named-issues.ts
import { pathToFileURL } from 'node:url'
import { githubApi } from './github-api.ts'

// GitHub's closing keywords, then `#n` of this repository (an `owner/repo#n` does not match).
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi

/** The text without its HTML comments. */
export const withoutComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '')

/** The body without HTML comments, fenced code or inline code: what GitHub reads as keywords. */
export function prose(body: string): string {
  return withoutComments(body)
    .replace(/^[^\S\n]*(`{3,}|~{3,})[\s\S]*?^[^\S\n]*\1/gm, '')
    .replace(/`[^`\n]*`/g, '')
}

/** The issue numbers the body closes, once each, in order; code and HTML comments are ignored. */
export function namedIssues(body: string): number[] {
  return [...new Set([...prose(body).matchAll(CLOSING)].map((match) => Number(match[1])))]
}

/** A call to the repository's issues REST API, `path` below `/issues/`; throws unless 2xx. */
export function issuesApi(repo: string, token: string) {
  const api = githubApi(repo, token)
  return (path: string, method = 'GET', payload?: object) =>
    api<{ state: string; body?: string | null; pull_request?: object }>(
      `issues/${path}`,
      method,
      payload,
    )
}

async function main(): Promise<void> {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_URL: url, PR_BODY: body } = process.env
  if (!token || !repo || !url)
    throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_URL are required.')
  const api = issuesApi(repo, token)
  // One issue that fails (a typo'd number, a deleted issue) never keeps the others open.
  for (const issue of namedIssues(body ?? '')) {
    try {
      const current = await api(`${issue}`)
      if (current.pull_request || current.state === 'closed') {
        console.log(
          `#${issue}: skipped (${current.pull_request ? 'a pull request' : 'already closed'}).`,
        )
        continue
      }
      // Closed first: a failed comment never leaves it open, a re-run never comments twice.
      await api(`${issue}`, 'PATCH', { state: 'closed', state_reason: 'completed' })
      await api(`${issue}/comments`, 'POST', { body: `Closed by ${url} (merged into develop).` })
      console.log(`#${issue}: closed.`)
    } catch (error) {
      console.error(`#${issue}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
