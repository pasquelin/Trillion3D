import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import {
  COMPOSE_ROWS_WGSL,
  PART_SPHERES,
} from '../../../packages/sdk-browser/src/placement/gpuComposeWgsl.ts'
import { ROW_INPUT_DOUBLES } from '../../../packages/sdk-browser/src/placement/composedRowPack.ts'
import { sphereRadius } from '../../../packages/sdk-browser/src/placement/rowSphere.ts'
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/src/visibility/buffer.ts'
import { ROW_PLACEMENT_WORD } from '../../../packages/sdk-browser/src/webgpu/row/rowPlacement.ts'
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts'
import { generated } from '../../../packages/sdk-browser/src/placement/composeDoubles.fixture.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { packDoubles } from '../../../packages/math/src/float/splitDouble.ts'
import { transformAffinePoint } from '../../../packages/sdk-core/src/index.ts'

const CASES = 600

/** The device's words and the CPU's for `CASES` generated rows: how many differ, and by how much. */
export async function runSphere() {
  const next = random(5)
  const worlds = new Uint32Array(CASES * 32),
    inputs = new Uint32Array(CASES * ROW_INPUT_DOUBLES * 2)
  const expected: number[] = []
  const f32 = new Float32Array(1),
    bits = new Uint32Array(f32.buffer)
  const word = (x: number) => ((f32[0] = x), bits[0])
  const c = new Float64Array(3)
  for (let i = 0; i < CASES; i++) {
    const far = [10, 1e3, 1e6][i % 3],
      w = generated(next, far)
    const centre = [0, 1, 2].map(() => (next() - 0.5) * 40),
      half = [0, 1, 2].map(() => 0.001 + next() * 5)
    packDoubles(worlds, i * 32, w)
    packDoubles(inputs, i * ROW_INPUT_DOUBLES * 2, [...centre, ...half])
    transformAffinePoint(c, w, centre[0], centre[1], centre[2], 0)
    const row = new Array(8).fill(0)
    for (let a = 0; a < 3; a++) {
      const high = Math.fround(c[a])
      row[a] = word(high)
      row[4 + a] = word(Math.fround(c[a] - high))
    }
    row[3] = word(sphereRadius(w, centre, half))
    expected.push(...row)
  }
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: true as const }
  const { device } = gpu
  const { module, compilation } = await gpu.compile(COMPOSE_ROWS_WGSL)
  if (compilation.length) return { errors: compilation }
  const buffer = (data: ArrayBufferView<ArrayBuffer> | number, usage = 0) => {
    const size = typeof data === 'number' ? data : Math.max(16, data.byteLength)
    const made = device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | usage,
    })
    if (typeof data !== 'number') device.queue.writeBuffer(made, 0, data)
    return made
  }
  // Every row's root is linked to slot 0, a parent at the identity: the composed world is its local.
  const stride = PAGE_INFO_STRIDE / 4,
    table = new Uint32Array(CASES * stride)
  for (let i = 0; i < CASES; i++) table[i * stride + ROW_PLACEMENT_WORD] = i
  const identity = new Float64Array(16)
  for (let k = 0; k < 4; k++) identity[k * 5] = 1
  const parents = new Uint32Array(32),
    locals = worlds
  packDoubles(parents, 0, identity)
  const params = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(params, 0, new Uint32Array([CASES, CASES, PART_SPHERES, 0]))
  const spheres = buffer(CASES * 8 * 4)
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  })
  const absent = () => buffer(16)
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: buffer(locals) } },
      { binding: 2, resource: { buffer: buffer(new Uint32Array(CASES)) } },
      { binding: 3, resource: { buffer: buffer(parents) } },
      { binding: 4, resource: { buffer: buffer(table) } },
      { binding: 5, resource: { buffer: spheres } },
      { binding: 6, resource: { buffer: buffer(inputs) } },
      { binding: 7, resource: { buffer: absent() } },
      { binding: 8, resource: { buffer: absent() } },
      { binding: 9, resource: { buffer: absent() } },
    ],
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(ceilDiv(CASES, 64))
  pass.end()
  device.queue.submit([encoder.finish()])
  const read = await readBuffer(device, spheres, 0, CASES * 8 * 4)
  const { court } = await gpu.fermer()
  const words = Array.from(read),
    run = { adapter: court, errors: gpu.errors }
  let centreDiffers = 0,
    radiusDiffers = 0,
    radiusUlps = 0
  for (let i = 0; i < CASES; i++) {
    for (const k of [0, 1, 2, 4, 5, 6])
      if (words[i * 8 + k] !== expected[i * 8 + k]) centreDiffers++
    const d = words[i * 8 + 3],
      e = expected[i * 8 + 3]
    if (d !== e) {
      radiusDiffers++
      radiusUlps = Math.max(radiusUlps, Math.abs(d - e))
    }
  }
  return {
    adapter: run.adapter,
    errors: run.errors,
    centreDiffers,
    radiusDiffers,
    radiusUlps,
  }
}
