// A made-up sun world for the first ray's proof (`vsmSunRayMisses`): `pageWorld.fixture.ts`'s
// page table (pages mapped, unmapped, or falling back 1-3 levels, mapped there or not) and
// projection records, over a pool of shapes rather than noise — each physical page a sloped ground
// with raised boxes, depths on a grid of 2^-10 so a reference depth often meets one exactly, and a
// few words no depth is: -0, NaN, +inf. The tile depths are each 8×8 tile's greatest word whose float
// is not below 0 or NaN, as `vsmTileDepthsBuild` writes them (`projectionEarlyOut.test.ts`).
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import {
  CODE,
  PAGE_FUNCTIONS,
  f32Bits,
  unit,
  vsmWorld,
  type Ptr as PtrOf,
} from './pageWorld.fixture.ts'
import { VSM_PAGE_TEXELS, VSM_TILE_DEPTHS_PER_PAGE } from './constants.ts'

/** The words no depth is, one texel in 200 each. */
const ODD = [0x80000000, 0x7fc00000, 0x7f800000]
/** Physical page rows of 128 pages (`vsmWorld`'s addresses: x < 128). */
const ROW_SHIFT = 7

/** Pool word of physical texel (x, y) of world `seed`. */
function poolWord(seed: number, x: number, y: number) {
  const px = x >> 7,
    py = y >> 7,
    u = x & 127,
    v = y & 127
  const odd = unit(seed, x, y, 11)
  if (odd < 0.015) return ODD[Math.floor(odd / 0.005)]
  const r = (k: number) => unit(seed, px, py, k)
  if (r(1) < 0.1) return 0 // an empty page
  let depth = 0.25 + 0.4 * r(2) + (r(3) - 0.5) * 0.004 * u + (r(4) - 0.5) * 0.004 * v
  // Up to three boxes a page, raised toward the light.
  for (let b = 0; b < 3; b++)
    if (r(10 + b) < 0.5) {
      const x0 = 128 * r(20 + b),
        y0 = 128 * r(30 + b),
        w = 4 + 40 * r(40 + b)
      if (u >= x0 && u < x0 + w && v >= y0 && v < y0 + w) depth += 0.02 + 0.2 * r(50 + b)
    }
  return f32Bits(Math.round(Math.min(1, Math.max(0, depth)) * 1024) / 1024)
}

/** A word as the tile depths hold it: its float, unless negative or NaN, which no test can fail. */
const tileDepthWord = (w: number) => (w > 0x7f800000 ? 0 : w)

/** World `seed`: its scope, its tiles' depths (read lazily), and the words read. */
export function earlyOutWorld(seed: number) {
  const world = vsmWorld(seed),
    tiles = new Map<number, number>(),
    side = Math.sqrt(VSM_TILE_DEPTHS_PER_PAGE),
    texels = VSM_PAGE_TEXELS / side
  const reads = { tiles: 0, pool: 0 }
  const tileDepth = (k: number) => {
    let word = tiles.get(k)
    if (word === undefined) {
      const page = Math.floor(k / (side * side)),
        tile = k % (side * side)
      const x0 = ((page & 127) << 7) + (tile % side) * texels,
        y0 = ((page >> ROW_SHIFT) << 7) + Math.floor(tile / side) * texels
      word = 0
      for (let y = y0; y < y0 + texels; y++)
        for (let x = x0; x < x0 + texels; x++)
          word = Math.max(word, tileDepthWord(poolWord(seed, x, y)))
      tiles.set(k, word)
    }
    return word
  }
  const scope = {
    ...world.scope,
    vsm: { ...world.scope.vsm, poolRowShift: ROW_SHIFT, traceReachSun: 1.5 },
    vsmPoolLoad: (t: number[]) => (reads.pool++, poolWord(seed, t[0], t[1])),
    vsmTileDepthsLoad: (k: number) => (reads.tiles++, tileDepth(k)),
  }
  return { scope, reads, tileDepth }
}

/** The march, the first ray's proof and what they read, by name. */
export const RAY_FUNCTIONS = [
  'vsmSunRayMisses',
  'vsmMarchSun',
  'vsmSunRayStep',
  'vsmSunRayUvz',
  'vsmMarchTimeLine',
  'vsmMarchTime',
  'vsmEmptyStep',
  'vsmTileDepthIndex',
  'vsmPoolIndexOf',
  ...PAGE_FUNCTIONS,
]
export type RayState = Record<string, unknown>
type Ptr = PtrOf<RayState>
export interface RayRun {
  vsmSunRayMisses: (p: Ptr, steps: number, offset: number) => boolean
  vsmMarchSun: (p: Ptr, s: number, o: number, e: boolean) => { hitFound: boolean }
}
export const rayRun = (scope: object) => shaderRun<RayRun>(CODE, RAY_FUNCTIONS, scope)
