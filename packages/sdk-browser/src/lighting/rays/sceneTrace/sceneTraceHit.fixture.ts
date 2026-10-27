// What the scene trace answers a ray, as the tests of the programs that cast through it stand it in (`stTrace`).
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

export interface Hit {
  distance: number
  placement: number
  object: number
  normal: Vec3
  frontFace: boolean
  twoSided: boolean
  hit: boolean
}

/** A miss, its placement and its object the trace's single sentinel, as the trace answers one. */
export const MISS: Hit = {
  distance: 0,
  placement: NO_INDEX,
  object: NO_INDEX,
  normal: [0, 0, 0],
  frontFace: true,
  twoSided: false,
  hit: false,
}
