import { parkedEntries } from '../../app/examples/list.ts'
import { issueUrl } from '../../content/model.ts'

/** Each example parked until the engine draws it, by its id: the issue it waits for and that
 *  issue's address. The runtime build runs this module and bundles only this map
 *  (`scripts/docs/inline-modules.ts`), not the roadmap. */
export const WAITING_ISSUES: Record<string, { issue: number; href: string }> = Object.fromEntries(
  parkedEntries.flatMap(({ id, issue }) =>
    issue === undefined ? [] : [[id, { issue, href: issueUrl(issue) }] as const],
  ),
)
