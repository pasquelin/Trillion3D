import { setupCompute } from './drawCompute.mjs';
import { setupVisibility } from './drawVisibility.mjs';
import { runCase } from './drawCase.mjs';

export async function run({ shader, visShader, cases, cap, maxVertexCount, pageStride }) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { unavailable: 'No WebGPU adapter' };
  // Deliberately do not request indirect-first-instance: slot starts must come from storage.
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  const module = device.createShaderModule({ code: shader }),
    visModule = device.createShaderModule({ code: visShader });
  const infos = await Promise.all([module.getCompilationInfo(), visModule.getCompilationInfo()]);
  const compilationErrors = infos.flatMap((info) =>
    info.messages.filter((message) => message.type === 'error').map((message) => message.message),
  );
  if (compilationErrors.length) {
    device.destroy();
    return { compilationErrors, errors };
  }
  const compute = setupCompute(device, module, cap);
  const {
    groups,
    makeBuffer,
    itemBuffer,
    uniform,
    instances,
    indirect,
    selectionOffset,
    offsets,
    selection,
    readUsage,
    instRead,
    cmdRead,
    offsetRead,
    group,
    pipelines,
  } = compute;
  const visibility = setupVisibility(
    device,
    visModule,
    pageStride,
    makeBuffer,
    instances,
    offsets,
    readUsage,
  );
  const { width, height, visPipelines, visGroups, views, pixelsRead, directPage } = visibility;
  const { target } = visibility;
  const results = [];
  for (const sample of cases)
    results.push(
      await runCase(sample, {
        device,
        cap,
        maxVertexCount,
        groups,
        selectionOffset,
        itemBuffer,
        selection,
        uniform,
        group,
        pipelines,
        views,
        visPipelines,
        visGroups,
        indirect,
        instances,
        offsets,
        instRead,
        cmdRead,
        offsetRead,
        pixelsRead,
        target,
        width,
        height,
        directPage,
      }),
    );
  await device.queue.onSubmittedWorkDone();
  const features = [...device.features],
    minStorageBufferOffsetAlignment = device.limits.minStorageBufferOffsetAlignment;
  device.destroy();
  return {
    adapter: {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      device: adapter.info.device,
      description: adapter.info.description,
    },
    features,
    minStorageBufferOffsetAlignment,
    results,
    directPage,
    errors,
  };
}
