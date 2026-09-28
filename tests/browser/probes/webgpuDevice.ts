// Opening a WebGPU device in the page, written once for every "GPU actually run" reproduction:
// DAG selection kernel, rasterisation, lighting normals, parented camera and wrap batches. Five
// copies of the same prologue had already drifted — one of them did not filter compilation
// messages and did not wait for the queue.
//
// This module knows only the browser: `pageWebgpu.ts` injects the text of `ouvrirAppareil` into
// the page (`toString`), and the page bundled by esbuild (`parentedCameraGpuPage.ts`) imports
// it. One writing for both paths, hence one contract.

/**
 * Opens the device, with those of `features` the adapter offers, hooks collection of uncaptured errors, and returns what is needed to compile
 * and close cleanly. Returns `null` when the page has no WebGPU adapter.
 *
 * - `compile(code)` returns `{ module, compilation }`; `compilation` keeps only messages of type
 *   `error`, WGSL compiler warnings not being correctness discrepancies.
 * - `fermer()` waits for the queue (`onSubmittedWorkDone`) before reading `adapter.info` and
 *   destroying the device, then returns the GPU reading in its two forms: `court` (vendor and
 *   architecture) and `complet` (the four filled fields). `adapter.info` is not cloneable, only
 *   these strings cross the page bridge.
 */
export async function ouvrirAppareil(features: GPUFeatureName[] = []) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  // The optional features asked, those the adapter has: the probe reads what was granted.
  const requiredFeatures = features.filter((feature) => adapter.features.has(feature));
  const device = await adapter.requestDevice({ requiredFeatures });
  const erreurs: string[] = [];
  device.addEventListener('uncapturederror', (event) => erreurs.push(event.error.message));
  return {
    device,
    erreurs,
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
      const champs = (['vendor', 'architecture', 'device', 'description'] as const).map(
        (c) => info[c],
      );
      device.destroy();
      return {
        court: `${champs[0]} ${champs[1]}`,
        complet: champs.filter(Boolean).join(' / '),
      };
    },
  };
}
