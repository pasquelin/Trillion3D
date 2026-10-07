import { encodeHizPyramid } from './pyramid.ts'
import { pyramidBytes } from './oracle.ts'
import {
  HIZ_BUILD_SIDE as S,
  HIZ_PASS_LEVELS,
  HIZ_UNIFORM_BINDING_BYTES,
  hizBuildPasses,
  hizBuildWords,
  hizUniformSlots,
} from './uniforms.ts'
import { evaluateHizReduce } from './oracle.fixture.ts'
import { uniformStride } from '../../residency/pools.ts'

// The reference pyramid build (a copy of level 0, then the per-level reduction the oracle
// states) and `buildHiz` transcribed line by line, for `buildEquivalence.test.ts`.
const SLOT_WORDS = HIZ_UNIFORM_BINDING_BYTES / 4

/** The tests' seeded random: the same sequence on every run. */
export function lcg(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

/** A compute pass that records each dispatch as its uniform slot's first word, then its grid. */
function recordingPass() {
  const dispatches: number[][] = []
  let slot = 0
  const pass = {
    setPipeline() {},
    setBindGroup: (_: number, __: unknown, offsets: number[]) => (slot = offsets[0] / 4),
    dispatchWorkgroups: (...grid: number[]) => dispatches.push([slot, ...grid]),
  } as unknown as GPUComputePassEncoder
  return { pass, dispatches }
}

export type Scene = {
  texture: Float32Array
  textureWidth: number
  width: number
  height: number
  maxLevels: number
  /** One origin per pyramid, or none: the camera's single pyramid from texel zero. */
  origins?: Array<[number, number]>
}

export function layout(scene: Scene) {
  const { sizes, offsets, texels: words } = pyramidBytes(scene.width, scene.height)
  const count = scene.origins?.length ?? 1
  const stride = scene.origins ? words : 0
  return { sizes, offsets, count, stride, words: words * count }
}

const texel = (scene: Scene, z: number, x: number, y: number) => {
  const [ox, oy] = scene.origins ? scene.origins[z] : [0, 0]
  return scene.texture[(oy + y) * scene.textureWidth + ox + x]
}

/** The copy of level 0, then the oracle's reduction of each mip from the one above. */
export function buildBefore(scene: Scene, pyramid: Float32Array) {
  const { sizes, offsets, count, stride } = layout(scene)
  for (let z = 0; z < count; z++) {
    for (let y = 0; y < scene.height; y++)
      for (let x = 0; x < scene.width; x++)
        pyramid[z * stride + y * scene.width + x] = texel(scene, z, x, y)
    for (let i = 0; i < sizes.length - 1 && i + 1 < scene.maxLevels; i++) {
      const [w, h] = sizes[i],
        src = pyramid.subarray(z * stride + offsets[i], z * stride + offsets[i] + w * h)
      pyramid.set(evaluateHizReduce(src, w, h).data, z * stride + offsets[i + 1])
    }
  }
}

/** `hizFar4`: the farthest of a clamped 2 × 2 square, in the per-level order. */
function far4(v00: number, v10: number, v01: number, v11: number, dx: number, dy: number) {
  let far = v00
  if (dx) far = Math.min(far, v10)
  if (dy) {
    far = Math.min(far, v01)
    if (dx) far = Math.min(far, v11)
  }
  return far
}

/** One `buildHiz` workgroup: S × S lanes, the barriers as phases, stale workgroup memory kept. */
function workgroup(
  scene: Scene,
  u: Uint32Array,
  pyramid: Float32Array,
  wg: number[],
  tile: Float32Array,
) {
  const [a, b, c, d, g] = u
  const dst = (k: number) => u.subarray(8 + 4 * k, 12 + 4 * k)
  const z = wg[2],
    at = a + z * g
  const source = (x: number, y: number) =>
    a !== 0 ? pyramid[at + y * b + x] : (pyramid[at + y * b + x] = texel(scene, z, x, y))
  const far = new Float32Array(S * S)
  for (let lane = 0; lane < S * S; lane++) {
    const x = wg[0] * S + (lane % S),
      y = wg[1] * S + Math.floor(lane / S),
      x0 = x * 2,
      y0 = y * 2
    far[lane] = 0
    if (x0 < b && y0 < c) {
      const dx = x0 + 1 < b ? 1 : 0,
        dy = y0 + 1 < c ? 1 : 0
      far[lane] = far4(
        source(x0, y0),
        source(x0 + dx, y0),
        source(x0, y0 + dy),
        source(x0 + dx, y0 + dy),
        dx,
        dy,
      )
      if (d > 0) pyramid[dst(0)[0] + z * g + y * dst(0)[1] + x] = far[lane]
    }
    tile[lane] = far[lane]
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
      live.push(lane)
    }
    // workgroupBarrier(): every read of the level is done before any lane overwrites the tile.
    for (const lane of live) {
      const tx = wg[0] * side + (lane % S),
        ty = wg[1] * side + Math.floor(lane / S)
      tile[lane] = far[lane]
      pyramid[offset + z * g + ty * dstW + tx] = far[lane]
    }
  }
}

/** `buildHiz` driven by the uniform words and the dispatches the host really encodes. */
export function buildAfter(scene: Scene, pyramid: Float32Array, rand: () => number) {
  const { sizes, offsets, count, stride } = layout(scene)
  const passes = hizBuildPasses(sizes, scene.maxLevels)
  const words = hizBuildWords(sizes, offsets, passes, uniformStride(), stride)
  const { pass, dispatches } = recordingPass()
  encodeHizPyramid(
    pass,
    {} as GPUBindGroup,
    {} as GPUComputePipeline,
    passes,
    passes.map((_, i) => hizUniformSlots().offset(i)),
    count,
  )
  for (const [at, gx, gy, gz] of dispatches) {
    const u = words.subarray(at, at + SLOT_WORDS)
    for (let z = 0; z < gz; z++)
      for (let y = 0; y < gy; y++)
        for (let x = 0; x < gx; x++) {
          // Whatever workgroup memory holds: an exact kernel never reads a texel it did not write.
          const tile = Float32Array.from({ length: S * S }, () => rand() * 1e9 - 5e8)
          workgroup(scene, u, pyramid, [x, y, z], tile)
        }
  }
}
