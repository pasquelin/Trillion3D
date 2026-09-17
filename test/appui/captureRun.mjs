import { captureFixture } from './captureFixture.mjs';
import { captureModel } from './captureModel.mjs';

export async function run({ sdkUrl, stableCaptures, pageBudget, mode, captureFrame }) {
  const THREE = await import('/.vite/deps/three.js');
  const { benchEngine } = await import('/15-virtualized-integration/implementation/engines.ts');
  const { createExplorer } = await import(sdkUrl);
  const { urbanPath, framesPerSegment, warmupFrames, runAaControl } =
    await import('/src/lab/modelCampaign.ts');
  const factory = benchEngine('webgpu-page-raster').factory,
    events = [],
    gpuErrors = [];
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw Error('No WebGPU adapter');
  const gpu = {
    vendor: adapter.info.vendor,
    architecture: adapter.info.architecture,
    device: adapter.info.device,
    description: adapter.info.description,
  };
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (event) => gpuErrors.push(event.error.message));
  const overlaps = await captureFixture({ THREE, factory, device, events });
  return captureModel({
    createExplorer,
    factory,
    pageBudget,
    stableCaptures,
    mode,
    captureFrame,
    events,
    gpu,
    gpuErrors,
    overlaps,
    urbanPath,
    framesPerSegment,
    warmupFrames,
    runAaControl,
  });
}
