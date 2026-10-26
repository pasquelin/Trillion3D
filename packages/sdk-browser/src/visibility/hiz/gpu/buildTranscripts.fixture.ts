import { encodeHizPyramid } from './pyramid.ts'
import {
  HIZ_BUILD_SIDE,
  HIZ_SLOT_WORDS,
  hizBuildPasses,
  hizBuildWords,
  hizUniformSlots,
  HIZ_UNI,
} from './uniforms.ts'
import { workgroup, type Layers } from './buildKernel.fixture.ts'
import { layout, texel, traceTexel, type Scene } from './buildScene.fixture.ts'
import { evaluateHizReduce } from './oracle.fixture.ts'
import { uniformStride } from '../../../session/memory/pools.ts'

// The reference pyramid build (the per-level reduction the oracle states, no copy of level 0) and
// `buildHiz` transcribed line by line, for `buildEquivalence.test.ts`: of the culling farthest layer
// from level 1 up, and — the full build, `Scene.trace` — of the nearest layer, its maximum, beside the
// finished depth's farthest (`Scene.planes`, the default), both reduced from the trace depth the
// pixels hold there (each pixel's plane corner, which `hizSource` returns).
const SLOT_WORDS = HIZ_SLOT_WORDS

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

/** The oracle's reduction of each mip from the one above, level 1 from the depth itself by the
 *  gather of 2×2 texels that never reads past the image. */
function reduceFrom(level0: Float32Array, into: Float32Array, scene: Scene, nearest: boolean) {
  const { sizes, offsets } = layout(scene)
  for (let i = 0; i < sizes.length - 1 && i + 1 < scene.maxLevels; i++) {
    const [w, h] = sizes[i],
      src = i ? into.subarray(offsets[i], offsets[i] + w * h) : level0
    into.set(evaluateHizReduce(src, w, h, nearest, i === 0).data, offsets[i + 1])
  }
}

/** The oracle's pyramid: the culling layer's levels from 1 up, and with the trace layers the nearest's
 *  and, with the planes, the finished depth's farthest from level 1 up. */
export function buildBefore(scene: Scene, layers: Layers) {
  const level0 = (depth: (x: number, y: number) => number) =>
    Float32Array.from({ length: scene.width * scene.height }, (_, i) =>
      depth(i % scene.width, Math.floor(i / scene.width)),
    )
  reduceFrom(
    level0((x, y) => texel(scene, x, y)),
    layers.cull,
    scene,
    false,
  )
  if (!scene.trace) return
  const folded = level0((x, y) => traceTexel(scene, x, y))
  reduceFrom(folded, layers.nearest, scene, true)
  if (scene.planes !== false) reduceFrom(folded, layers.whole, scene, false)
}

/** `buildHiz` driven by the uniform words and the dispatches the host really encodes. */
export function buildAfter(scene: Scene, layers: Layers, rand: () => number) {
  const { sizes, routed, first, upper } = layout(scene)
  const passes = hizBuildPasses(sizes, scene.maxLevels)
  const words = hizBuildWords(sizes, routed, passes, uniformStride(), upper)
  // The host's planes word, up in every slot of a full build that keeps them.
  if (scene.trace && scene.planes !== false)
    for (let i = 0; i < passes.length; i++) words[(i * uniformStride()) / 4 + HIZ_UNI.at.planes] = 1
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
        const tile = Float32Array.from(
          { length: 3 * HIZ_BUILD_SIDE * HIZ_BUILD_SIDE },
          () => rand() * 1e9 - 5e8,
        )
        workgroup(scene, u, first, layers, [x, y], tile)
      }
  }
}
