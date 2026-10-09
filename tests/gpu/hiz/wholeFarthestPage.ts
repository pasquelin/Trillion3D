// The depth pyramid's three layers on the machine's device (`gpu/hiz/shader.ts`): the occluders'
// depth built by `encodePyramid`, then a finished depth, nearer where more was drawn, by
// `encodeNearest`. The pyramid texture is read back whole and compared with the oracle's
// reductions (`sdk-core/src/hiz/oracles.fixture.ts`), bit for bit.
import { createGpuHiz } from '../../../packages/sdk-browser/src/gpu/hiz/factory.ts'
import type { Pyramid } from '../../../packages/sdk-browser/src/gpu/hiz/pyramid.ts'
import {
  packHizPyramid,
  packWholeFarthest,
} from '../../../packages/sdk-browser/src/gpu/hiz/oracle.fixture.ts'
import { pyramidBytes } from '../../../packages/sdk-browser/src/gpu/hiz/oracle.ts'
import {
  HIZ_CULL_FARTHEST,
  HIZ_WHOLE_FARTHEST,
  hizTextureSize,
} from '../../../packages/sdk-browser/src/gpu/hiz/pyramidTexture.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { alignUp } from '../../../packages/math/src/scalar/integers.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

export type WholeFarthestCase = { width: number; height: number; seed: number }

const rowsOf = (depth: Float32Array, width: number, height: number) =>
  Array.from({ length: height }, (_, y) => Array.from(depth.subarray(y * width, (y + 1) * width)))

/** One layer of the pyramid texture, read back: its words, `texels` of them. */
async function readLayer(device: GPUDevice, texture: GPUTexture, layer: number, texels: number) {
  const { width, height } = hizTextureSize(texels)
  const pitch = alignUp(width * 4, 256)
  const target = device.createBuffer({
    size: pitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer(
    { texture, origin: [0, 0, layer] },
    { buffer: target, bytesPerRow: pitch },
    [width, height, 1],
  )
  device.queue.submit([encoder.finish()])
  await target.mapAsync(GPUMapMode.READ)
  const mapped = new Uint32Array(target.getMappedRange().slice(0))
  target.destroy()
  const words = new Uint32Array(texels)
  for (let i = 0; i < texels; i++)
    words[i] = mapped[Math.floor(i / width) * (pitch / 4) + (i % width)]
  return words
}

export async function testWholeFarthest(cases: WholeFarthestCase[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const mismatches: string[] = []
  for (const { width, height, seed } of cases) {
    const hiz = await createGpuHiz(device, width, height, 1)
    if (!hiz) throw new Error('the Hi-Z does not build')
    // The build's own bounds and state: the partition's, which owns them, is not mounted here.
    hiz.attach(
      device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
      device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
    )
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
    const { texels } = pyramidBytes(width, height)
    const cull = await readLayer(device, pyramid.pyramid, HIZ_CULL_FARTHEST, texels)
    const whole = await readLayer(device, pyramid.pyramid, HIZ_WHOLE_FARTHEST, texels)
    const bits = (packed: Float32Array) => new Uint32Array(packed.buffer)
    const expectCull = bits(packHizPyramid(rowsOf(occluders, width, height)).data)
    const expectWhole = bits(packWholeFarthest(rowsOf(finished, width, height)).data)
    const label = `${width}×${height}`
    let wrong = 0
    for (let i = 0; i < texels; i++) if (cull[i] !== expectCull[i]) wrong++
    if (wrong)
      mismatches.push(`${label}: ${wrong} culling texels differ from the occluders' pyramid`)
    wrong = 0
    for (let i = 0; i < texels; i++) if (whole[i] !== expectWhole[i]) wrong++
    if (wrong) mismatches.push(`${label}: ${wrong} texels differ from the finished depth's pyramid`)
    hiz.dispose()
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, mismatches, errors: gpu.errors }
}
