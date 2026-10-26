/**
 * THE SETTINGS THE VIEW'S SHAPE READS (`source.ts`): the list of those that shape its circle or
 * sector — what the update's key holds too (`streamingUpdate.ts`) — and the watch that tells
 * whether one of the settings a test reads (those, and the cull by height) moved since it last
 * looked.
 *
 * Cost: O(settings) per look, once per update.
 */
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'

/** The settings that shape the view's circle or sector: the update reads them too. */
export const SOURCE_SHAPE = [
  'useGridRange',
  'rangeScale',
  'radius',
  'sector',
  'sectorAngle',
  'force2D',
  'extraRadius',
  'extraAngle',
] as const
/** The settings `meets` and `radius` read. */
const READ = [...SOURCE_SHAPE, 'zCulling'] as const

/** The watch of the settings `streaming` holds as they stand: each call says whether one a test
 *  reads changed since the last call, and sees them as they are now. */
export function watchSourceSettings(streaming: WorldStreaming) {
  const seen = READ.map(() => NaN)
  return () => {
    let moved = false
    for (let at = 0; at < READ.length; at++) {
      const now = Number(streaming[READ[at]])
      moved ||= seen[at] !== now
      seen[at] = now
    }
    return moved
  }
}
