/**
 * Page side of `dag-kernels-compile-gpu.ts`: the engine's own build of the DAG selection kernel
 * (`createDagStages`, `pipeline.ts`) on a real WebGPU device, for each text and each `SPLIT`
 * choice. Bundled by esbuild then run in Chromium, like `cutDispatchesPage.ts`: the stages the
 * probe validates are the ones the engine builds, never a hand copy.
 */
import { createDagStages } from '../../../packages/sdk-browser/src/gpu/dag/pipeline.ts';
import { dagBindEntries } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts';
import { shaderErrors } from '../../../packages/sdk-browser/src/gpu/core/shaderModule.ts';
import { validationScope } from '../../../packages/sdk-browser/src/gpu/core/errorScope.ts';
import { ouvrirAppareil } from './webgpuDevice.ts';

/** One text to compile, under its name. */
export type KernelText = { name: string; code: string };
/** What the device refused of one text under one `SPLIT` choice: compiler errors, then validation. */
export type KernelVerdict = { name: string; split: boolean; errors: string[] };

export async function compileKernels(texts: KernelText[]) {
  const gpu = await ouvrirAppareil();
  if (!gpu) return { unavailable: 'no WebGPU adapter' };
  const { device } = gpu;
  const layout = device.createBindGroupLayout({ entries: dagBindEntries() });
  const verdicts: KernelVerdict[] = [];
  for (const { name, code } of texts) {
    // Under its own scope, so a refused text leaves nothing to the device's uncaptured errors.
    const { value: module } = await validationScope(device, () =>
      device.createShaderModule({ label: name, code }),
    );
    const compiled = (await shaderErrors(module)).map((message) => `module: ${message.message}`);
    for (const split of [false, true]) {
      const { error } = await validationScope(device, () =>
        createDagStages(device, layout, module, split),
      );
      const errors = error ? [...compiled, `stages: ${error.message}`] : compiled;
      verdicts.push({ name, split, errors });
    }
  }
  const { complet } = await gpu.fermer();
  return { adapter: complet, verdicts, uncaptured: gpu.erreurs };
}
