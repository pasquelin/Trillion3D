import { WAITING_ISSUES } from './waiting.inline.ts';
import { fill, kitWord } from './words.ts';

/** The repository's issues, where a parked example's line points. */
const ISSUES = 'https://github.com/pasquelin/Trillion3D/issues/';

/** What a parked example says of the engine issue it waits for — `kit.banner.waiting`, its
 *  `{issue}` filled, and the issue's address — or `undefined` for an example that waits on
 *  nothing. */
export function waitingLine(id: string): { text: string; href: string } | undefined {
  const issue = WAITING_ISSUES[id];
  if (issue === undefined) return undefined;
  const text = fill(kitWord('banner', 'waiting', 'Waiting for the engine (#{issue})'), { issue });
  return { text, href: `${ISSUES}${issue}` };
}
