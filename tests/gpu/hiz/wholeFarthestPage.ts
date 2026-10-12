// The depth pyramid's three layers on the machine's device (`gpu/hiz/shader.ts`): the occluders'
// depth built by `encodePyramid`, then a finished depth, nearer where more was drawn, by
// `encodeNearest`. The pyramid texture is read back whole and compared with the oracle's
// reductions (`sdk-core/src/hiz/oracles.fixture.ts`), bit for bit; the finished depth's farthest
// layer reduces the far corner of each pixel's plane, not its depth.
import { fromHalf, toHalf } from '../../../packages/math/src/float/half.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'
import { standaloneHiz } from '../kit/standaloneHiz.ts'
import type { Pyramid } from '../../../packages/sdk-browser/src/gpu/hiz/pyramid.ts'
import {
  packHizPyramid,
  packWholeFarthest,
  hizPackedFrom,
} from '../../../packages/sdk-browser/src/gpu/hiz/oracle.fixture.ts'
import { pyramidBytes } from '../../../packages/sdk-browser/src/gpu/hiz/oracle.ts'
import {
  HIZ_CULL_FARTHEST,
  HIZ_WHOLE_FARTHEST,
  hizTextureSize,
} from '../../../packages/sdk-browser/src/gpu/hiz/pyramidTexture.ts'
import { SURFACE_SLOPE_WGSL } from '../../../packages/sdk-browser/src/lighting/deferred/footprintWgsl.ts'
import { shaderRun } from '../../../packages/sdk-browser/src/texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

export type WholeFarthestCase = { width: number; height: number; seed: number }

const rowsOf = (depth: Float32Array, width: number, height: number) =>
  Array.from({ length: height }, (_, y) => Array.from(depth.subarray(y * width, (y + 1) * width)))

const f = Math.fround

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
}>(SURFACE_SLOPE_WGSL, ['surfaceSlopeOf'], {})

/** The farthest corner of each pixel's plane (`hizPlaneCorners`): the depth less half the sum of
 *  its slopes, the slopes relative to the depth and held in half floats, as the build holds them. */
function farthestCorners(depth: Float32Array, width: number, height: number) {
  const at = (x: number, y: number) =>
    depth[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)]
  return Float32Array.from(depth, (z, i) => {
    const x = i % width,
      y = (i - x) / width
    const held = (slope: number) => (z > 0 ? f(fromHalf(toHalf(f(slope / z))) * z) : 0)
    const sx = held(slopeOf(z, at(x - 1, y), at(x + 1, y), at(x - 2, y), at(x + 2, y)))
    const sy = held(slopeOf(z, at(x, y - 1), at(x, y + 1), at(x, y - 2), at(x, y + 2)))
    return Math.max(f(z - f(0.5 * f(Math.abs(sx) + Math.abs(sy)))), 0)
  })
}

/** Two corner words equal to within the half float the slope is held in (2⁻¹¹ of a depth, which is at most one): the GPU's
 *  division is not the correctly rounded one the model makes, and the slope is held in 16 bits. */
function sameCorner(a: number, b: number) {
  if (a === b) return true
  const x = new Float32Array(new Uint32Array([a, b]).buffer)
  return Math.abs(x[0] - x[1]) <= 2 ** -11
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
    draw(occluders, (open) => hiz.encodePyramid(open))
    draw(finished, (open) => hiz.encodeNearest(open))
    const size = pyramidBytes(width, height),
      { texels } = size
    const layers = []
    for (let layer = 0; layer < 3; layer++)
      layers.push(await readLayer(device, pyramid.pyramid, layer, size))
    const cull = hizPackedFrom(layers, HIZ_CULL_FARTHEST, size)
    const whole = hizPackedFrom(layers, HIZ_WHOLE_FARTHEST, size)
    const bits = (packed: Float32Array) => new Uint32Array(packed.buffer)
    const expectCull = bits(packHizPyramid(rowsOf(occluders, width, height)).data)
    const expectWhole = bits(
      packWholeFarthest(rowsOf(farthestCorners(finished, width, height), width, height)).data,
    )
    const label = `${width}×${height}`
    let wrong = 0
    for (let i = 0; i < texels; i++) if (cull[i] !== expectCull[i]) wrong++
    if (wrong)
      mismatches.push(`${label}: ${wrong} culling texels differ from the occluders' pyramid`)
    wrong = 0
    for (let i = 0; i < texels; i++) if (!sameCorner(whole[i], expectWhole[i])) wrong++
    if (wrong) mismatches.push(`${label}: ${wrong} texels differ from the finished depth's pyramid`)
    hiz.dispose()
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, mismatches, errors: gpu.errors }
}
