import { WAITING_ISSUES } from './waiting.inline.ts'
import { fill, kitWord } from './words.ts'

/** What a parked example says of the engine issue it waits for — `kit.banner.waiting`, its
 *  `{issue}` filled, and the issue's address — or `undefined` for an example that waits on
 *  nothing. */
export function waitingLine(id: string): { text: string; href: string } | undefined {
  const waiting = WAITING_ISSUES[id]
  if (!waiting) return undefined
  const text = kitWord('banner', 'waiting', 'Waiting for the engine (#{issue})')
  return { text: fill(text, { issue: waiting.issue }), href: waiting.href }
}
