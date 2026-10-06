// The item-by-item frustum walk, verbatim: the oracle `hierarchy.test.ts` ranks the same
// scene with (`orderBlendPasses`'s `cull`), the equivalence harness.
import { notDrawn } from '../../placement/hidden.ts'
import { frustumExcludesBox } from '../../../../sdk-core/src/index.ts'
import { paintOutcome, type blendSceneOf } from './plan.fixture.ts'

type BlendState = ReturnType<typeof blendSceneOf>

export function rejectByFrustum(blendState: BlendState) {
  const items = blendState.blendGpu,
    keep = blendState.keepPacked,
    planes = blendState.blendPlanes
  let rejected = 0,
    transmissiveInView = 0,
    bouge = false,
    mot = 0
  const pose = (rang: number) => {
    if (keep[rang] !== mot >>> 0) {
      keep[rang] = mot
      bouge = true
    }
    mot = 0
  }
  for (let i = 0; i < items.length; i++) {
    const box = items[i].bounds
    const parked = notDrawn(items[i])
    if (
      !parked &&
      box &&
      frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5])
    )
      rejected++
    else if (!parked) {
      mot |= 1 << (i & 31)
      if (items[i].transmissive) transmissiveInView++
    }
    if ((i & 31) === 31) pose(i >>> 5)
  }
  if (items.length & 31) pose(items.length >>> 5)
  blendState.keepMoved = bouge
  blendState.transmissiveInView = transmissiveInView
  return rejected
}

/** Everything a ranking hands the frame. */
export function outcome(blendState: BlendState, rejected: number) {
  return {
    rejected,
    keep: Array.from(blendState.keepPacked),
    keepMoved: blendState.keepMoved,
    water: blendState.transmissiveInView,
    ...paintOutcome(blendState),
  }
}
