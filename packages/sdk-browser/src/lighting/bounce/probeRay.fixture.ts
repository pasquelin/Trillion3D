// The `probeRay` function of a world probe's ray as the tests run it (`shaderRun`).
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'

export interface ProbeRayModule {
  probeRay: (
    origin: Vec3,
    d: Vec3,
    begin: number,
    reach: number,
    side: number,
    coord: number[],
  ) => {
    lighting: Vec3
    open: number
    distance: number
    steps: number
    front: boolean
    twoSided: boolean
  }
}
