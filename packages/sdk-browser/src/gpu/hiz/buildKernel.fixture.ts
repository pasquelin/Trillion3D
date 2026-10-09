import { HIZ_BUILD_SIDE as S, HIZ_PASS_LEVELS } from './uniforms.ts'
import { texel, type Scene } from './buildScene.fixture.ts'

// `buildHiz`, one workgroup of it, transcribed line by line (`buildTranscripts.fixture.ts`).

/** `hizBound4`: the bound of a clamped 2 × 2 square, in the per-level order — the farthest, or
 *  the nearest. */
function bound4(
  bound: (a: number, b: number) => number,
  v00: number,
  v10: number,
  v01: number,
  v11: number,
  dx: number,
  dy: number,
) {
  let reduced = v00
  if (dx) reduced = bound(reduced, v10)
  if (dy) {
    reduced = bound(reduced, v01)
    if (dx) reduced = bound(reduced, v11)
  }
  return reduced
}

/** One `buildHiz` workgroup: S × S lanes, the barriers as phases, stale workgroup memory kept. */
export function workgroup(
  scene: Scene,
  u: Uint32Array,
  pyramid: Float32Array,
  whole: Float32Array,
  wg: number[],
  tile: Float32Array,
  tileWhole: Float32Array,
) {
  const [a, b, c, d, g] = u
  const dst = (k: number) => u.subarray(8 + 4 * k, 12 + 4 * k)
  const z = wg[2],
    at = a + z * g
  const bound = scene.nearest ? Math.max : Math.min
  const far4 = (v00: number, v10: number, v01: number, v11: number, dx: number, dy: number) =>
    bound4(bound, v00, v10, v01, v11, dx, dy)
  // `hizSource`: the pair of bounds of a texel, the layer's own and the farthest of the depth.
  const source = (x: number, y: number): [number, number] =>
    a !== 0
      ? [pyramid[at + y * b + x], scene.nearest ? whole[at + y * b + x] : pyramid[at + y * b + x]]
      : scene.nearest
        ? [texel(scene, z, x, y), texel(scene, z, x, y)]
        : [(pyramid[at + y * b + x] = texel(scene, z, x, y)), texel(scene, z, x, y)]
  const far = new Float32Array(S * S),
    farWhole = new Float32Array(S * S)
  for (let lane = 0; lane < S * S; lane++) {
    const x = wg[0] * S + (lane % S),
      y = wg[1] * S + Math.floor(lane / S),
      x0 = x * 2,
      y0 = y * 2
    far[lane] = farWhole[lane] = 0
    if (x0 < b && y0 < c) {
      const dx = x0 + 1 < b ? 1 : 0,
        dy = y0 + 1 < c ? 1 : 0
      const s = [source(x0, y0), source(x0 + dx, y0), source(x0, y0 + dy), source(x0 + dx, y0 + dy)]
      far[lane] = far4(s[0][0], s[1][0], s[2][0], s[3][0], dx, dy)
      farWhole[lane] = bound4(Math.min, s[0][1], s[1][1], s[2][1], s[3][1], dx, dy)
      if (d > 0) {
        pyramid[dst(0)[0] + z * g + y * dst(0)[1] + x] = far[lane]
        if (scene.nearest) whole[dst(0)[0] + z * g + y * dst(0)[1] + x] = farWhole[lane]
      }
    }
    tile[lane] = far[lane]
    tileWhole[lane] = farWhole[lane]
  }
  for (let k = 1, side = S >> 1; k < Math.min(d, HIZ_PASS_LEVELS); k++, side >>= 1) {
    const [, w, h] = dst(k - 1),
      [offset, dstW, dstH] = dst(k)
    const live: number[] = []
    for (let lane = 0; lane < S * S; lane++) {
      const lx = lane % S,
        ly = Math.floor(lane / S),
        tx = wg[0] * side + lx,
        ty = wg[1] * side + ly
      if (!(lx < side && ly < side && tx < dstW && ty < dstH)) continue
      const i = ly * 2 * S + lx * 2,
        dx = tx * 2 + 1 < w ? 1 : 0,
        dy = ty * 2 + 1 < h ? 1 : 0
      far[lane] = far4(tile[i], tile[i + dx], tile[i + dy * S], tile[i + dy * S + dx], dx, dy)
      farWhole[lane] = bound4(
        Math.min,
        tileWhole[i],
        tileWhole[i + dx],
        tileWhole[i + dy * S],
        tileWhole[i + dy * S + dx],
        dx,
        dy,
      )
      live.push(lane)
    }
    // workgroupBarrier(): every read of the level is done before any lane overwrites the tile.
    for (const lane of live) {
      const tx = wg[0] * side + (lane % S),
        ty = wg[1] * side + Math.floor(lane / S)
      tile[lane] = far[lane]
      tileWhole[lane] = farWhole[lane]
      pyramid[offset + z * g + ty * dstW + tx] = far[lane]
      if (scene.nearest) whole[offset + z * g + ty * dstW + tx] = farWhole[lane]
    }
  }
}
