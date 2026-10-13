// The exact filter of proof P3 (`cardTilesPage.ts`): a map's trilinear read in float64 — each
// level's bilinear at the exact sub-texel weights, clamped to the level's edge, and the two levels
// mixed by the exact fraction —, its texels decoded as the sampler decodes them (sRGB colour,
// linear coverage and data). Beside it, the pool's reads and the old hardware reads
// (`cardTileReads.ts`): at a whole level the pool must return the hardware's own value, bit for
// bit; between two, its error against the exact filter must be no larger than the hardware's.
import { srgbToLinear } from '../../../packages/math/src/color/color.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'
import type { Chain } from './cardTileRig.ts'

/** What two f32 roundings of a mix may add to an error that is otherwise the same: 2^-22. */
const MIX_ROUNDING = 2 ** -22

/** Channel `c` of texel `(x, y)` of level `l` of `chain`, decoded; the colour's three first
 *  channels sRGB. */
const texel = (chain: Chain, srgb: boolean, l: number, x: number, y: number, c: number) => {
  const byte = chain.levels[l][(y * (chain.side >> l) + x) * 4 + c] / 255
  return srgb && c < 3 ? srgbToLinear(byte) : byte
}

/** Level `l`'s bilinear read of channel `c` at `(u, v)`, the edge clamped. */
function bilinear(chain: Chain, srgb: boolean, l: number, u: number, v: number, c: number) {
  const side = chain.side >> l,
    x = u * side - 0.5,
    y = v * side - 0.5
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0
  const at = (i: number, j: number) =>
    texel(chain, srgb, l, clamp(i, 0, side - 1), clamp(j, 0, side - 1), c)
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
  return top * (1 - fy) + bottom * fy
}

/** The exact trilinear read of channel `c` of `chain` at `(u, v)` and level `lod`, clamped to
 *  the chain. */
function trilinear(chain: Chain, srgb: boolean, u: number, v: number, lod: number, c: number) {
  const last = chain.levels.length - 1,
    level = clamp(lod, 0, last),
    l0 = Math.floor(level),
    t = level - l0
  const a = bilinear(chain, srgb, l0, u, v, c)
  return t === 0 ? a : a + t * (bilinear(chain, srgb, l0 + 1, u, v, c) - a)
}

/** How one level's reads compare, in 8-bit steps: the values whose two reads differ at all, those
 *  where the pool lies farther from the exact filter than the hardware and by how much at most,
 *  and each read's largest and root-mean-square error. */
type LevelReads = {
  lod: number
  whole: boolean
  values: number
  unequal: number
  worse: number
  excess: number
  poolMax: number
  chainMax: number
  poolRms: number
  chainRms: number
}

/** The pool's reads and the chains' (`cardTileReads`) at `taps`, against the exact filter of the
 *  card's three `maps`, level by level: `points` taps a level. */
export function compareReads(
  taps: Float32Array,
  reads: { pool: Float32Array; chains: Float32Array },
  maps: { colour: Chain; normalDepth: Chain; orm: Chain },
  points: number,
) {
  const chains = [maps.colour, maps.normalDepth, maps.orm],
    levels: LevelReads[] = []
  for (let k = 0; k * points < taps.length / 4; k++) {
    const lod = taps[k * points * 4 + 2],
      whole = Number.isInteger(lod)
    const row: LevelReads = {
      lod,
      whole,
      values: 0,
      unequal: 0,
      worse: 0,
      excess: 0,
      poolMax: 0,
      chainMax: 0,
      poolRms: 0,
      chainRms: 0,
    }
    for (let n = k * points; n < (k + 1) * points; n++)
      chains.forEach((chain, map) => {
        for (let c = 0; c < 4; c++) {
          const at = (3 * n + map) * 4 + c,
            exact = trilinear(chain, map === 0, taps[n * 4], taps[n * 4 + 1], lod, c)
          const p = Math.abs(reads.pool[at] - exact),
            h = Math.abs(reads.chains[at] - exact)
          row.values++
          if (reads.pool[at] !== reads.chains[at]) row.unequal++
          if (p > h + MIX_ROUNDING) row.worse++
          row.excess = Math.max(row.excess, (p - h) * 255)
          row.poolMax = Math.max(row.poolMax, p * 255)
          row.chainMax = Math.max(row.chainMax, h * 255)
          row.poolRms += (p * 255) ** 2
          row.chainRms += (h * 255) ** 2
        }
      })
    row.poolRms = Math.sqrt(row.poolRms / row.values)
    row.chainRms = Math.sqrt(row.chainRms / row.values)
    levels.push(row)
  }
  return levels
}
