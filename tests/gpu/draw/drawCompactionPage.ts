// The engine's GPU draw compaction (`createGpuDraw`) and the visibility raster that consumes it,
// on a device that does not ask for `indirect-first-instance`: each slot's start must come from
// storage, never from the indirect command.
import { createGpuDraw } from '../../../packages/sdk-browser/src/gpu/draw/draw.ts'
import { VIS_SHADER } from '../../../packages/sdk-browser/src/visibility/buffer.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { runCase, type DrawCase } from './drawCase.ts'
import { setupVisibility } from './drawVisibility.ts'

/** Every case on one compaction of `cap` rows of one-triangle pages, in turn: what each left. */
export async function runDrawCompaction({ cases, cap }: { cases: DrawCase[]; cap: number }) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const draw = await createGpuDraw(device, cap, 1, 3)
  if (!draw) throw new Error('the GPU draw compaction does not mount')
  const { module, compilation } = await gpu.compile(VIS_SHADER)
  if (compilation.length) throw new Error(`the visibility shader does not compile: ${compilation}`)
  const vis = setupVisibility(
    device,
    module,
    { instances: draw.instanceBuffer, slotOffsets: draw.slotOffsetsBuffer },
    draw.slots,
  )
  const results = []
  for (const sample of cases) results.push(await runCase(device, draw, vis, cap, sample))
  const features = [...device.features]
  const alignment = device.limits.minStorageBufferOffsetAlignment
  draw.dispose()
  const { court: adapter } = await gpu.fermer()
  return { adapter, features, alignment, results, errors: gpu.errors }
}
