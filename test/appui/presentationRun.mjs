import { createChecks } from './presentationChecks.mjs';
import { runCase } from './presentationCase.mjs';

export async function run({ sdkBase }) {
  const THREE = await import('/.vite/deps/three.js');
  const { webgpuPagesBackend } = await import(sdkBase + '/webgpuPages.js');
  const { createSynchronousCanvasCapture } = await import(sdkBase + '/gpuPresentation.js');
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const gpuErrors = [],
    checks = [],
    events = [],
    passes = [];
  device.addEventListener('uncapturederror', (event) => gpuErrors.push(event.error.message));
  const createEncoder = device.createCommandEncoder.bind(device);
  device.createCommandEncoder = (descriptor) => {
    const encoder = createEncoder(descriptor),
      begin = encoder.beginRenderPass.bind(encoder);
    encoder.beginRenderPass = (descriptor) => {
      passes.push({
        name: descriptor.label ?? '',
        colorAttachments: descriptor.colorAttachments.filter(Boolean).length,
      });
      return begin(descriptor);
    };
    return encoder;
  };
  const { check, equal, checkNormalPasses } = createChecks(checks);
  const capture = createSynchronousCanvasCapture();
  const fixtures = [
    { name: 'unlit', kind: 'unlit' },
    { name: 'textured PBR', kind: 'pbr' },
    { name: 'masked PBR', kind: 'mask' },
    { name: 'transparent PBR', kind: 'blend' },
    { name: 'implicit canvas', kind: 'pbr', implicitCanvas: true },
  ];
  try {
    for (const fixture of fixtures)
      await runCase(fixture, {
        THREE,
        webgpuPagesBackend,
        device,
        events,
        passes,
        capture,
        check,
        equal,
        checkNormalPasses,
        checks,
      });
    await device.queue.onSubmittedWorkDone();
    check(
      !events.some((event) => /failed|uncaptured-error/.test(event.phase)),
      'Backend reported a GPU failure',
    );
    check(gpuErrors.length === 0, 'WebGPU validation errors: ' + gpuErrors.join('; '));
    return {
      adapter: {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description,
      },
      checks,
      gpuErrors,
      events,
      userAgent: navigator.userAgent,
    };
  } finally {
    capture.dispose();
    device.destroy();
  }
}
