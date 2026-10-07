// One compute shader run on Dawn, its storage output read back: the shape of every proof that runs
// an engine WGSL function on known inputs (`../visibility/shading-point.gpu.ts`,
// `../shadow/blend-transmittance.gpu.ts`, `../texture/pool-place.gpu.ts`, ...).
import {
  computeReadback,
  type ComputeInput,
  type ComputeReadbackOptions,
} from './computeReadback.ts'
import { runOnDawn } from './onDawn.ts'
import { openGpuModule } from './webgpuDevice.ts'

/** How a run reads, as `computeReadback` does; `setup`, when given, makes its inputs on the device
 *  — a texture written, a sampler — in place of `inputs`. */
export type ComputeRunOptions = ComputeReadbackOptions & {
  setup?: (device: GPUDevice) => ComputeInput[]
}

type Run = { code: string; bytes: number; workgroups: number; options?: ComputeRunOptions }

/** `code`'s `main` dispatched over `workgroups` groups on a device of its own, its storage output
 *  read back as `bytes / 4` floats (or as `options` say); the adapter, and the compilation and
 *  uncaptured errors, which must be none. */
export async function runCompute({ code, bytes, workgroups, options = {} }: Run) {
  const opened = await openGpuModule(code)
  if (!opened.module)
    return {
      adapter: '',
      values: [],
      errors: 'compilation' in opened ? opened.compilation : [opened.unavailable],
    }
  const { gpu, module } = opened
  const pipeline = await gpu.device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  })
  const { setup, ...read } = options
  const inputs = setup ? setup(gpu.device) : read.inputs
  const values = await computeReadback(gpu.device, pipeline, bytes, workgroups, {
    ...read,
    inputs,
  })
  const { court: adapter } = await gpu.fermer()
  return { adapter, values, errors: gpu.errors }
}

/** `runCompute` on Dawn, from a proof. */
export const computeOnDawn = (
  code: string,
  bytes: number,
  workgroups = 1,
  options?: ComputeRunOptions,
) => runOnDawn(runCompute, { code, bytes, workgroups, options })
