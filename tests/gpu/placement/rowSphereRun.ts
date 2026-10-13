import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { f32Bits } from '../../../packages/math/src/float/bits.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { autoKernel, bufferHolding, groupZero } from '../kit/computeReadback.ts'
import {
  DERIVE_ROWS_ENTRY,
  DERIVE_ROWS_WGSL,
  PART_SPHERES,
} from '../../../packages/sdk-browser/src/placement/rowWordsWgsl.ts'
import {
  INPUT_FLAGS,
  ROW_HAS_RECORD,
  ROW_INPUT_DOUBLES,
} from '../../../packages/sdk-browser/src/placement/rowInputPack.ts'
import { sphereRadius } from '../../../packages/sdk-browser/src/placement/rowSphere.ts'
import { ROW_WORDS } from '../../../packages/sdk-browser/src/visibility/types.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { generated } from '../../../packages/sdk-browser/src/placement/composeDoubles.fixture.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { packDoubles } from '../../../packages/math/src/float/splitDouble.ts'
import { transformAffinePoint } from '../../../packages/sdk-core/src/index.ts'
import { PAGE_INFO } from '../../../packages/sdk-browser/src/visibility/pageInfo.ts'

const CASES = 600

/** The device's words and the CPU's for `CASES` generated rows: how many differ, and by how much. */
export async function runSphere() {
  const next = lcgRandom(5)
  const worlds = new Uint32Array(CASES * 32),
    inputs = new Uint32Array(CASES * ROW_INPUT_DOUBLES * 2)
  const expected: number[] = []
  const c = new Float64Array(3)
  for (let i = 0; i < CASES; i++) {
    const far = [10, 1e3, 1e6][i % 3],
      w = generated(next, far)
    const centre = [0, 1, 2].map(() => (next() - 0.5) * 40),
      half = [0, 1, 2].map(() => 0.001 + next() * 5)
    packDoubles(worlds, i * 32, w)
    packDoubles(inputs, i * ROW_INPUT_DOUBLES * 2, [...centre, ...half])
    inputs[(i * ROW_INPUT_DOUBLES + INPUT_FLAGS) * 2] = ROW_HAS_RECORD
    transformAffinePoint(c, w, centre[0], centre[1], centre[2], 0)
    const row = new Array(8).fill(0)
    for (let a = 0; a < 3; a++) {
      const high = Math.fround(c[a])
      row[a] = f32Bits(high)
      row[4 + a] = f32Bits(Math.fround(c[a] - high))
    }
    row[3] = f32Bits(sphereRadius(w, centre, half))
    expected.push(...row)
  }
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: true as const }
  const { device } = gpu
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  const { module, compilation } = await gpu.compile(DERIVE_ROWS_WGSL)
  if (compilation.length) return { errors: compilation }
  const buffer = (data: ArrayBufferView<ArrayBuffer>) => bufferHolding(device, data, STORAGE, 16)
  // Row `i` is root `i`'s, its world the roots' double world the rows pass reads.
  const stride = ROW_WORDS,
    table = new Uint32Array(CASES * stride)
  for (let i = 0; i < CASES; i++) table[i * stride + PAGE_INFO.at.placement] = i
  // Every row of the table (`all`): the pass's list names none.
  const params = bufferHolding(
    device,
    new Uint32Array([CASES, PART_SPHERES, CASES, 1, 0, 0, 0, 0]),
    GPUBufferUsage.UNIFORM,
  )
  const spheres = gpu.buffer(CASES * 8 * 4, STORAGE)
  const pipeline = await device.createComputePipelineAsync(autoKernel(module, DERIVE_ROWS_ENTRY))
  const absent = () => gpu.buffer(16, STORAGE)
  const group = groupZero(
    device,
    pipeline,
    [
      params,
      buffer(worlds),
      buffer(table),
      spheres,
      buffer(inputs),
      absent(),
      absent(),
      absent(),
      absent(),
      absent(),
      absent(),
    ].map((held) => ({ buffer: held })),
  )
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(ceilDiv(CASES, 64))
  pass.end()
  device.queue.submit([encoder.finish()])
  const read = (await readGpuBuffer(device, spheres, CASES * 8 * 4))!
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
