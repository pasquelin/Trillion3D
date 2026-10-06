// The engine's own build of the DAG selection stages (`createDagStages`, `stages.ts`) on the
// machine's device, for each text and each `SPLIT` choice: the stages `kernels-compile.gpu.ts`
// validates are the ones the engine builds, never a hand copy.
import { createDagStages } from '../../../packages/sdk-browser/src/gpu/dag/stages.ts'
import { dagBindEntries } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { shaderErrors } from '../../../packages/sdk-browser/src/gpu/core/shaderModule.ts'
import { validationScope } from '../../../packages/sdk-browser/src/gpu/core/errorScope.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

/** One text to compile, under its name. */
export type KernelText = { name: string; code: string }
/** What the device refused of one text under one `SPLIT` choice: compiler errors, then validation. */
export type KernelVerdict = { name: string; split: boolean; errors: string[] }

export async function compileKernels(texts: KernelText[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const layout = device.createBindGroupLayout({ entries: dagBindEntries() })
  const verdicts: KernelVerdict[] = []
  for (const { name, code } of texts) {
    // Under its own scope, so a refused text leaves nothing to the device's uncaptured errors.
    const { value: module } = await validationScope(device, () =>
      device.createShaderModule({ label: name, code }),
    )
    const compiled = (await shaderErrors(module)).map((message) => `module: ${message.message}`)
    for (const split of [false, true]) {
      // A stage compiled off the thread is refused by its promise, not in the scope.
      const { error } = await validationScope(device, () =>
        createDagStages(device, layout, module, split),
      ).catch((refused: Error) => ({ error: refused }))
      const errors = error ? [...compiled, `stages: ${error.message}`] : compiled
      verdicts.push({ name, split, errors })
    }
  }
  const { complet: adapter } = await gpu.fermer()
  return { adapter, verdicts, uncaptured: gpu.errors }
}
