import { encodeHizPyramid } from './pyramid.ts'
import {
  HIZ_BUILD_SIDE as S,
  HIZ_SLOT_WORDS,
  hizBuildPasses,
  hizBuildWords,
  hizUniformSlots,
} from './uniforms.ts'
import { workgroup } from './buildKernel.fixture.ts'
import { layout, texel, type Scene } from './buildScene.fixture.ts'
import { evaluateHizReduce } from './oracle.fixture.ts'
import { uniformStride } from '../../residency/pools.ts'

// The reference pyramid build (a copy of level 0, then the per-level reduction the oracle
// states) and `buildHiz` transcribed line by line, for `buildEquivalence.test.ts`: of the culling
// farthest layer, or of the nearest (`Scene.nearest`), whose level 0 the texture's texels stand
// for — each pixel's plane corner, which `hizSource` returns there — and is not copied; the nearest
// build also writes the finished depth's farthest layer, from level 1 (`whole`).
const SLOT_WORDS = HIZ_SLOT_WORDS

/** The tests' seeded random, the lcg32 sequence: the same on every run. */
export { layout, type Scene } from './buildScene.fixture.ts'
export { lcgRandom as lcg } from '../../../../math/src/sequence/random.ts'

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

/** The copy of level 0 — the culling layer's —, then the oracle's reduction of each mip from the
 *  one above; the nearest layer reduces level 0 as the texture holds it, and writes none, while
 *  `whole` takes the farthest of the same depth from level 1 up. */
export function buildBefore(scene: Scene, pyramid: Float32Array, whole: Float32Array) {
  const { sizes, offsets } = layout(scene)
  const nearest = !!scene.nearest
  const level0 = new Float32Array(scene.width * scene.height)
  for (let y = 0; y < scene.height; y++)
    for (let x = 0; x < scene.width; x++) level0[y * scene.width + x] = texel(scene, x, y)
  if (!nearest) pyramid.set(level0, 0)
  for (let i = 0; i < sizes.length - 1 && i + 1 < scene.maxLevels; i++) {
    const [w, h] = sizes[i],
      src = i ? pyramid.subarray(offsets[i], offsets[i] + w * h) : level0
    pyramid.set(evaluateHizReduce(src, w, h, nearest).data, offsets[i + 1])
    if (nearest) {
      const farther = i ? whole.subarray(offsets[i], offsets[i] + w * h) : level0
      whole.set(evaluateHizReduce(farther, w, h).data, offsets[i + 1])
    }
  }
}

/** `buildHiz` driven by the uniform words and the dispatches the host really encodes. */
export function buildAfter(
  scene: Scene,
  pyramid: Float32Array,
  whole: Float32Array,
  rand: () => number,
) {
  const { sizes, routed, first, upper } = layout(scene)
  const passes = hizBuildPasses(sizes, scene.maxLevels)
  const words = hizBuildWords(sizes, routed, passes, uniformStride(), upper)
  const { pass, dispatches } = recordingPass()
  encodeHizPyramid(
    pass,
    {} as GPUBindGroup,
    {} as GPUComputePipeline,
    passes,
    passes.map((_, i) => hizUniformSlots().offset(i)),
  )
  for (const [at, gx, gy] of dispatches) {
    const u = words.subarray(at, at + SLOT_WORDS)
    for (let y = 0; y < gy; y++)
      for (let x = 0; x < gx; x++) {
        // Whatever workgroup memory holds: an exact kernel never reads a texel it did not write.
        const tile = Float32Array.from({ length: S * S }, () => rand() * 1e9 - 5e8)
        const tileWhole = Float32Array.from({ length: S * S }, () => rand() * 1e9 - 5e8)
        workgroup(scene, u, first, pyramid, whole, [x, y], tile, tileWhole)
      }
  }
}
