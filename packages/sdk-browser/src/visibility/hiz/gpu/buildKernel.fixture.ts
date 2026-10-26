import { HIZ_BUILD_SIDE, HIZ_PASS_LEVELS, HIZ_UNI } from './uniforms.ts'
import { texel, traceTexel, type Scene } from './buildScene.fixture.ts'
import { hizRoute } from './pyramidTexture.ts'
import { hizSquareStart } from '../../../../../sdk-core/src/hiz/oracles.fixture.ts'

// `buildHiz`, one workgroup of it, transcribed line by line (`buildTranscripts.fixture.ts`).

/** The packed levels of the three bounds, in natural order (`pyramidBytes`): the culling farthest,
 *  the nearest, and the finished depth's farthest. */
export type Layers = { cull: Float32Array; nearest: Float32Array; whole: Float32Array }

/** A triple of bounds (`hizBound`): the culling farthest, the nearest, the finished depth's farthest. */
type Triple = [number, number, number]

/** `hizBound`: reverse-Z, the farthest is the minimum, the nearest the maximum. */
const bound = (a: Triple, b: Triple): Triple => [
  Math.min(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.min(a[2], b[2]),
]

/** `hizBound4`: the bound of a clamped 2 × 2 square, in the per-level order. */
function bound4(v00: Triple, v10: Triple, v01: Triple, v11: Triple, dx: number, dy: number) {
  let reduced = v00
  if (dx) reduced = bound(reduced, v10)
  if (dy) {
    reduced = bound(reduced, v01)
    if (dx) reduced = bound(reduced, v11)
  }
  return reduced
}

/** One `buildHiz` workgroup: S × S lanes, the barriers as phases, stale workgroup memory kept
 *  (`tile`, three words a lane). The arrays hold the packed levels in natural order
 *  (`pyramidBytes`), `first` texels at level 0: the passes' indices, in the culling layer's routing
 *  (`hizRoute`), are put back in it. */
export function workgroup(
  scene: Scene,
  u: Uint32Array,
  first: number,
  layers: Layers,
  wg: number[],
  tile: Float32Array,
) {
  const [rawA, b, c, d] = u
  /** The flag of the routed indices of the coarser levels: where `hizRoute` puts the first of them. */
  const flag = hizRoute(first, 1, 0, { first, upper: 0 })
  const natural = (index: number) => (index >= flag ? index - flag + first : index)
  const at = natural(rawA)
  const dst = (k: number) => {
    const [offset, w, h] = u.subarray(8 + 4 * k, 11 + 4 * k)
    return [natural(offset), w, h]
  }
  const trace = !!scene.trace
  // The finished depth's farthest layer is written where the full build keeps the planes.
  const writesWhole = trace && u[HIZ_UNI.at.planes] !== 0
  // `hizSource`: the triple of bounds of a texel; `hizLoadBound` reads what a pass wrote.
  const source = (x: number, y: number): Triple => {
    const i = at + y * b + x
    if (at !== 0)
      return [layers.cull[i], trace ? layers.nearest[i] : 0, writesWhole ? layers.whole[i] : 0]
    const folded = traceTexel(scene, x, y)
    return [texel(scene, x, y), trace ? folded : 0, writesWhole ? folded : 0]
  }
  /** `hizPutBound`. */
  const put = (i: number, value: Triple) => {
    layers.cull[i] = value[0]
    if (trace) layers.nearest[i] = value[1]
    if (writesWhole) layers.whole[i] = value[2]
  }
  const lanes = HIZ_BUILD_SIDE * HIZ_BUILD_SIDE
  const far = new Array<Triple>(lanes)
  const keep = (lane: number, value: Triple) => {
    far[lane] = value
    tile.set(value, 3 * lane)
  }
  const held = (lane: number): Triple => [tile[3 * lane], tile[3 * lane + 1], tile[3 * lane + 2]]
  for (let lane = 0; lane < lanes; lane++) {
    const x = wg[0] * HIZ_BUILD_SIDE + (lane % HIZ_BUILD_SIDE),
      y = wg[1] * HIZ_BUILD_SIDE + Math.floor(lane / HIZ_BUILD_SIDE),
      x0 = hizSquareStart(x, b, at === 0),
      y0 = hizSquareStart(y, c, at === 0)
    let value: Triple = [0, 0, 0]
    if (x * 2 < b && y * 2 < c) {
      const dx = x0 + 1 < b ? 1 : 0,
        dy = y0 + 1 < c ? 1 : 0
      value = bound4(
        source(x0, y0),
        source(x0 + dx, y0),
        source(x0, y0 + dy),
        source(x0 + dx, y0 + dy),
        dx,
        dy,
      )
      if (d > 0) put(dst(0)[0] + y * dst(0)[1] + x, value)
    }
    keep(lane, value)
  }
  for (let k = 1, side = HIZ_BUILD_SIDE >> 1; k < Math.min(d, HIZ_PASS_LEVELS); k++, side >>= 1) {
    const [, w, h] = dst(k - 1),
      [offset, dstW, dstH] = dst(k)
    const live: number[] = []
    for (let lane = 0; lane < lanes; lane++) {
      const lx = lane % HIZ_BUILD_SIDE,
        ly = Math.floor(lane / HIZ_BUILD_SIDE),
        tx = wg[0] * side + lx,
        ty = wg[1] * side + ly
      if (!(lx < side && ly < side && tx < dstW && ty < dstH)) continue
      const i = ly * 2 * HIZ_BUILD_SIDE + lx * 2,
        dx = tx * 2 + 1 < w ? 1 : 0,
        dy = ty * 2 + 1 < h ? 1 : 0
      far[lane] = bound4(
        held(i),
        held(i + dx),
        held(i + dy * HIZ_BUILD_SIDE),
        held(i + dy * HIZ_BUILD_SIDE + dx),
        dx,
        dy,
      )
      live.push(lane)
    }
    // workgroupBarrier(): every read of the level is done before any lane overwrites the tile.
    for (const lane of live) {
      const tx = wg[0] * side + (lane % HIZ_BUILD_SIDE),
        ty = wg[1] * side + Math.floor(lane / HIZ_BUILD_SIDE)
      keep(lane, far[lane])
      put(offset + ty * dstW + tx, far[lane])
    }
  }
}
