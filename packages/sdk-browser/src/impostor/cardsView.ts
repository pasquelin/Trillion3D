import { frustumExcludesBox } from '../../../math/src/geometry/frustum/box.ts'
import { cardAsk } from './cardAsk.ts'
import { giveCard, mark, takeCard } from './cardHolders.ts'
import { refit } from './cardSegment.ts'
import type { CardSegment } from './cardSlots.ts'
import type { ImpostorCards } from './cards.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'

/** Each mesh with a switched root whose box the view holds: its maps asked for what its cards read
 *  (`cardAsk`), its cards taken once they are ready or given back when they no longer are, and its
 *  run drawn. A mesh out of view leaves the roots that switched to their card, which draws nothing
 *  there either way, until the view asks its maps. */
export function drawable(state: ImpostorCards, cam: EngineCamera, focal: number) {
  state.runCount = state.count = 0
  for (const segment of state.segments.values()) {
    const { pending, hold } = segment
    if (!segment.eligible.count) {
      state.hooks.release(hold)
      pending.length = 0
      continue
    }
    if (segment.stale) refit(state, segment)
    const box = segment.box
    if (frustumExcludesBox(cam.planes, box[0], box[1], box[2], box[3], box[4], box[5])) {
      // Out of view, its maps' tiles go back to the queue: the view asks them again.
      state.hooks.release(hold)
      if (!segment.gated) for (const rank of pending) cardAt(state, segment, rank, true)
      pending.length = 0
      continue
    }
    pending.length = 0
    const { tiles } = segment
    const ready =
        tiles !== undefined && state.hooks.ready(tiles, cardAsk(segment, cam.eye, focal), hold),
      held = segment.ready && !segment.gated,
      gated = segment.gated
    segment.ready = ready
    segment.gated = !ready
    // In view and not ready, its roots keep their clusters until its tiles land; once ready, each
    // takes its card.
    if (!ready ? !gated : !held) {
      const { list, count } = segment.eligible
      for (let i = 0; i < count; i++) cardAt(state, segment, list[i], ready)
    }
    if (!ready || !segment.count) continue
    const run = (state.runs[state.runCount++] ??= { first: 0, count: 0 })
    run.first = segment.start
    run.count = segment.count
    state.count += segment.count
  }
}

/** Root `rank`'s card bit set or cleared, its card taken when its mesh's maps are ready. */
function cardAt(state: ImpostorCards, segment: CardSegment, rank: number, card: boolean) {
  if (!segment.eligible.has(rank)) return
  mark(state, rank, card)
  if (!card) giveCard(state, segment, rank)
  else if (segment.ready) takeCard(state, segment, rank)
}
