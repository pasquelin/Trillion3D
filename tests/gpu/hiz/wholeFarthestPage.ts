// The depth pyramid's two slices on the machine's device (`hiz/gpu/shader.ts`): the occluders'
// depth built by `encodePyramid`, then a finished depth, nearer where more was drawn, by
// `encodeFull`. The pyramid texture is read back whole after each build and compared with the
// oracle's reductions (`sdk-core/src/hiz/oracles.fixture.ts`), bit for bit: after the occluders'
// build the culling layer is the occluders' pyramid; after the full build it is the FINISHED
// depth's — the reference reduces its furthest and its closest depth of the scene depth in the one
// build, the furthest then being the finished depth's, not the pre-pass's —, and the finished
// depth's farthest layer reduces the far corner of each pixel's plane, not its depth. A texel that
// differs is named by its level and place.
import { fromF32Bits } from '../../../packages/math/src/float/bits.ts'
import { fromHalf, toHalf } from '../../../packages/math/src/float/half.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'
import { standaloneHiz } from '../../kit/device/standaloneHiz.ts'
import type { Pyramid } from '../../../packages/sdk-browser/src/visibility/hiz/gpu/pyramid.ts'
import {
  packHizPyramid,
  packWholeFarthest,
  hizPackedFrom,
} from '../../../packages/sdk-browser/src/visibility/hiz/gpu/oracle.fixture.ts'
import { pyramidBytes } from '../../../packages/sdk-browser/src/visibility/hiz/gpu/oracle.ts'
import {
  HIZ_CULL_FARTHEST,
  HIZ_WHOLE_FARTHEST,
  hizTextureSize,
} from '../../../packages/sdk-browser/src/visibility/hiz/gpu/pyramidTexture.ts'
import { surfaceSlopeOf } from '../../../packages/math/src/wgsl/sampling.ts'
import { shaderRun } from '../../../packages/sdk-browser/src/materials/texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { readTexture } from '../../kit/device/computeReadback.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'

export type WholeFarthestCase = { width: number; height: number; seed: number }

/** The pyramid's levels from 1 up: level 0 is the depth texture itself, which the pyramid texture does not
 *  hold (`packWholeFarthest`). */
const upperLevels = (packed: ReturnType<typeof packHizPyramid>) => {
  packed.data.fill(0, 0, packed.offsets[1] ?? packed.data.length)
  return packed.data
}

const rowsOf = (depth: Float32Array, width: number, height: number) =>
  Array.from({ length: height }, (_, y) => Array.from(depth.subarray(y * width, (y + 1) * width)))

/** The slope rule the build holds, the shipped WGSL run as JavaScript: this model's reductions and
 *  half-float rounding are independent of the build's, the rule they apply is the build's own. */
const { surfaceSlopeOf: slopeOf } = shaderRun<{
  surfaceSlopeOf: (
    z: number,
    before: number,
    after: number,
    farBefore: number,
    farAfter: number,
  ) => number
}>(surfaceSlopeOf, ['surfaceSlopeOf'], {})

/** The farthest corner of each pixel's plane (`hizPlaneCorners`): the depth less half the sum of
 *  its slopes, the slopes relative to the depth and held in half floats, as the build holds them. */
function farthestCorners(depth: Float32Array, width: number, height: number) {
  const at = (x: number, y: number) =>
    depth[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)]
  return Float32Array.from(depth, (z, i) => {
    const x = i % width,
      y = (i - x) / width
    const held = (slope: number) =>
      z > 0 ? Math.fround(fromHalf(toHalf(Math.fround(slope / z))) * z) : 0
    const sx = held(slopeOf(z, at(x - 1, y), at(x + 1, y), at(x - 2, y), at(x + 2, y)))
    const sy = held(slopeOf(z, at(x, y - 1), at(x, y + 1), at(x, y - 2), at(x, y + 2)))
    return Math.max(Math.fround(z - Math.fround(0.5 * Math.fround(Math.abs(sx) + Math.abs(sy)))), 0)
  })
}

/** Two corner words equal to within the half float the slope is held in (2⁻¹¹ of a depth, which is at most one): the GPU's
 *  division is not the correctly rounded one the model makes, and the slope is held in 16 bits. */
function sameCorner(a: number, b: number) {
  if (a === b) return true
  return Math.abs(fromF32Bits(a) - fromF32Bits(b)) <= 2 ** -11
}

/** One layer of the pyramid texture, read back: its words. */
async function readLayer(
  device: GPUDevice,
  texture: GPUTexture,
  layer: number,
  size: { first: number; upper: number },
) {
  const { width, height } = hizTextureSize(size)
  const bytes = await readTexture(device, texture, 4, { layer, width, height })
  return new Uint32Array(bytes.buffer)
}

export async function testWholeFarthest(cases: WholeFarthestCase[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const mismatches: string[] = []
  for (const { width, height, seed } of cases) {
    const { hiz } = await standaloneHiz(device, width, height)
    const pyramid = hiz.swap(undefined) as Pyramid
    hiz.swap(pyramid)
    const rand = lcgRandom(seed)
    const occluders = Float32Array.from({ length: width * height }, () => rand())
    // The rest of the scene only comes nearer (reverse-Z: larger), and fills holes.
    const finished = Float32Array.from(occluders, (z) => (rand() < 0.5 ? Math.max(z, rand()) : z))
    const draw = (
      depth: Float32Array<ArrayBuffer>,
      build: (open: { pass: GPUComputePassEncoder }) => void,
    ) => {
      device.queue.writeTexture({ texture: hiz.level0 }, depth, { bytesPerRow: width * 4 }, [
        width,
        height,
      ])
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      build({ pass })
      pass.end()
      device.queue.submit([encoder.finish()])
    }
    const size = pyramidBytes(width, height),
      { texels } = size
    const label = `${width}×${height}`
    const bits = (packed: Float32Array) => new Uint32Array(packed.buffer)
    const layersOf = async () => {
      const layers = []
      for (let layer = 0; layer < 2; layer++)
        layers.push(await readLayer(device, pyramid.pyramid, layer, size))
      return layers
    }
    /** The texels of `got` that differ from `want`, named by their level and place. */
    const differ = (
      what: string,
      got: Uint32Array,
      want: Uint32Array,
      same: (a: number, b: number) => boolean = (a, b) => a === b,
    ) => {
      const wrong: number[] = []
      for (let i = 0; i < texels; i++) if (!same(got[i], want[i])) wrong.push(i)
      if (!wrong.length) return
      const place = (i: number) => {
        const level = size.offsets.findLastIndex((offset) => offset <= i)
        const [w] = size.sizes[level]
        const at = i - size.offsets[level]
        return `level ${level} (${at % w}, ${Math.floor(at / w)})`
      }
      mismatches.push(
        `${label}: ${wrong.length} ${what}, first ${wrong
          .slice(0, 6)
          .map((i) => `${place(i)} ${got[i].toString(16)} for ${want[i].toString(16)}`)
          .join('; ')}`,
      )
    }
    draw(occluders, (open) => hiz.encodePyramid(open))
    const built = await layersOf()
    differ(
      "culling texels differ from the occluders' pyramid",
      hizPackedFrom(built, HIZ_CULL_FARTHEST, size),
      bits(upperLevels(packHizPyramid(rowsOf(occluders, width, height)))),
    )
    // The finished depth's farthest layer is the planes' build's (`hizTrace` `'planes'`).
    hiz.planes(true)
    draw(finished, (open) => hiz.encodeFull(open))
    const layers = await layersOf()
    differ(
      "culling texels differ from the finished depth's pyramid",
      hizPackedFrom(layers, HIZ_CULL_FARTHEST, size),
      bits(upperLevels(packHizPyramid(rowsOf(finished, width, height)))),
    )
    differ(
      "texels differ from the finished depth's planes pyramid",
      hizPackedFrom(layers, HIZ_WHOLE_FARTHEST, size),
      bits(packWholeFarthest(rowsOf(farthestCorners(finished, width, height), width, height)).data),
      sameCorner,
    )
    hiz.dispose()
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, mismatches, errors: gpu.errors }
}
