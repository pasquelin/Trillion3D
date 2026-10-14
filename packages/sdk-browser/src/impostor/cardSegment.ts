import { transformAffinePoint } from '../../../math/src/vector/vector.ts'
import { boxEmpty, boxUnion } from '../../../math/src/geometry/box.ts'
import { core } from './borrowed.ts'
import type { CardSegment } from './cardSlots.ts'
import type { ImpostorCards } from './cards.ts'

// A mesh's segment of the cards (`cards.ts`): made as its first root switches, its box the pivot
// spheres of its switched roots.

const pivot = new Float64Array(3),
  ORIGIN = [0, 0, 0] as const

/** The segment of `mesh`, made as its first root switches. */
export function segmentOf(state: ImpostorCards, mesh: number): CardSegment {
  let segment = state.segments.get(mesh)
  if (!segment) {
    segment = {
      mesh,
      entry: state.baked.get(mesh)!,
      start: state.slots.used,
      capacity: 0,
      count: 0,
      cards: [],
      holders: new Map(),
      eligible: core.createDenseKeySet(),
      box: new Float64Array(6),
      stale: false,
      radii: Float64Array.of(Infinity, 0),
      tiles: state.hooks.tilesOf(mesh),
      hold: core.createCardHold(),
      state: 'unseen',
      pending: [],
    }
    boxEmpty(segment.box, 0)
    state.segments.set(mesh, segment)
  }
  return segment
}

/** Root `rank`'s pivot sphere joined to its segment's box. */
export function grow(state: ImpostorCards, segment: CardSegment, rank: number) {
  const centre = segment.entry.centre ?? ORIGIN,
    radius = state.watch.radiusOf(rank),
    radii = segment.radii
  radii[0] = Math.min(radii[0], radius)
  radii[1] = Math.max(radii[1], radius)
  transformAffinePoint(pivot, state.roots[rank].world.elements, centre[0], centre[1], centre[2])
  const [x, y, z] = pivot
  boxUnion(segment.box, 0, x - radius, y - radius, z - radius, x + radius, y + radius, z + radius)
}

/** The segment's box fitted again to the roots switched: one left or moved since. */
export function refit(state: ImpostorCards, segment: CardSegment) {
  segment.stale = false
  boxEmpty(segment.box, 0)
  segment.radii[0] = Infinity
  segment.radii[1] = 0
  const { list, count } = segment.eligible
  for (let i = 0; i < count; i++) grow(state, segment, list[i])
}
