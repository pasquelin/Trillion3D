// What the water proofs render and what they predict from: shared by the pages, which build the
// scenes, and the test, which computes the expected centre of each from the same numbers.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { colorBytesPerSample } from '../../../packages/sdk-browser/src/gpu/core/colorBytes.fixture.ts'
import { waterSurfaceTargets } from '../../../packages/sdk-browser/src/webgpu/water/surfaceTargets.ts'

interface WaterMaterial {
  tint: [number, number, number]
  ior: number
  attenuationDistance: number
  attenuationColor: [number, number, number]
}

/** The water material of every case: what the proof computes its expectations from. */
export const WATER: WaterMaterial = {
  tint: [0.85, 0.95, 1],
  ior: 1.33,
  attenuationDistance: 6,
  attenuationColor: [0.35, 0.72, 0.68],
}

/** The water surface: `WATER`, transmitting `transmission` through a declared `thickness`. */
export const waterSurface = (transmission: number, thickness: number) =>
  Object.assign(
    G.physicalSurface({
      color: new G.Color(WATER.tint),
      transparent: true,
      opacity: 1,
      side: G.DOUBLE_SIDE,
      roughness: 0.05,
    }),
    {
      transmission,
      ior: WATER.ior,
      thickness,
      attenuationDistance: WATER.attenuationDistance,
      attenuationColor: new G.Color(WATER.attenuationColor),
    },
  )

/** The colour bytes per sample the water surface stage writes, from its own targets: the limit
 *  a device must grant for the water pass to run. */
export const WATER_ATTACHMENT_BYTES = colorBytesPerSample(
  waterSurfaceTargets(true).map((target) => target.format),
)

interface GroundSpec {
  color: [number, number, number]
  depth: number
}

/** The opaque ground behind the tile, and its distance from the tile along the optical axis. */
export const GROUND: GroundSpec = { color: [0.72, 0.58, 0.4], depth: 2 }

/** Display background of the page: what a surface in front of nothing must let through. */
export const BACKGROUND = 0x336699

export interface WaterCase {
  name: string
  transmission: number
  thickness: number
  groundX: number
}

/** The cases: a transmission, a thickness, and where the ground sits — behind the tile, or aside
 *  of it so that the scene keeps an opaque and the tile's centre sees nothing behind it. */
export const CASES: WaterCase[] = [
  { name: 'basin', transmission: 1, thickness: 2, groundX: 0 },
  { name: 'declared-deeper', transmission: 1, thickness: 10, groundX: 0 },
  { name: 'nothing-behind', transmission: 1, thickness: 2, groundX: 6 },
  { name: 'blend', transmission: 0, thickness: 2, groundX: 0 },
]
