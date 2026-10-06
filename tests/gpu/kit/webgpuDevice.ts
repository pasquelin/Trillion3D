// The WebGPU device every proof runs on, written once: the device the engine opens for a world
// (`requestExplorerDevice`) — every optional feature it can use, the adapter's limits up to what it
// binds — so the engine is proved on the device a page gives it, never on WebGPU's default limits,
// which it exceeds (eighteen sampled textures in a fragment stage where the default grants sixteen).

import { requestExplorerDevice } from '../../../packages/sdk-browser/src/world/session/gpuDevice.ts';

/**
 * Opens the engine's device, hooks collection of uncaptured errors, and returns what is needed to
 * compile and close cleanly; `null` when there is no WebGPU adapter. `features` and
 * `requiredLimits` name what the proof needs of it: those the adapter offers must be granted, or
 * the opening throws, naming them.
 *
 * - `compile(code)` returns `{ module, compilation }`; `compilation` keeps only messages of type
 *   `error`, WGSL compiler warnings not being correctness discrepancies.
 * - `fermer()` waits for the queue (`onSubmittedWorkDone`) before reading `adapter.info` and
 *   destroying the device, then returns the GPU reading in its two forms: `court` (vendor and
 *   architecture) and `complet` (the four filled fields).
 */
export async function openGpuDevice(
  features: GPUFeatureName[] = [],
  requiredLimits: Record<string, number> = {},
) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await requestExplorerDevice(adapter);
  const held = device.limits as unknown as Record<string, number>;
  // A `min…` limit is an alignment: the device holds it when its own is no larger.
  const lacking = [
    ...features.filter((name) => adapter.features.has(name) && !device.features.has(name)),
    ...Object.entries(requiredLimits)
      .filter(
        ([name, value]) => !(name.startsWith('min') ? held[name] <= value : held[name] >= value),
      )
      .map(([name, value]) => `${name} ${value}`),
  ];
  if (lacking.length) {
    device.destroy();
    throw new Error(`the engine's device lacks what the proof needs: ${lacking.join(', ')}`);
  }
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  return {
    device,
    errors,
    async compile(code: string) {
      const module = device.createShaderModule({ code });
      const compilation = (await module.getCompilationInfo()).messages
        .filter((message) => message.type === 'error')
        .map((message) => message.message);
      return { module, compilation };
    },
    async fermer() {
      await device.queue.onSubmittedWorkDone();
      const info = adapter.info ?? {};
      const fields = (['vendor', 'architecture', 'device', 'description'] as const).map(
        (c) => info[c],
      );
      device.destroy();
      return {
        court: `${fields[0]} ${fields[1]}`,
        complet: fields.filter(Boolean).join(' / '),
      };
    },
  };
}

/**
 * Opens the device and compiles `code`, the prologue of every one-shader probe: the device and its
 * module, or the result the probe returns as is (no adapter, or the compiler's errors).
 */
export async function openGpuModule(
  code: string,
): Promise<
  | { unavailable: string; module?: undefined }
  | { compilation: string[]; errors: string[]; module?: undefined }
  | { gpu: NonNullable<Awaited<ReturnType<typeof openGpuDevice>>>; module: GPUShaderModule }
> {
  const gpu = await openGpuDevice();
  if (!gpu) return { unavailable: 'no WebGPU adapter' };
  const { module, compilation } = await gpu.compile(code);
  if (compilation.length) return { compilation, errors: gpu.errors };
  return { gpu, module };
}
