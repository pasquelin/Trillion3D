import { smokeGroup, smokeRender } from './gpu.ts';
import { SMOKE_PASSES, type SmokeFrame, type SmokeSpec } from './plan.ts';
import { SMOKE_RAYMARCH, SMOKE_UPSAMPLE } from './renderWgsl.ts';
import type { SmokeResources } from './resources.ts';

export async function smokeDraw(device: GPUDevice, spec: SmokeSpec, r: SmokeResources) {
  const march = await smokeRender(
    device,
    SMOKE_RAYMARCH,
    ['uniform', 'state', 'linear'],
    [{ format: 'rgba16float' }, { format: 'r32float' }],
    SMOKE_PASSES[4],
  );
  const blend: GPUBlendComponent = {
    srcFactor: 'one',
    dstFactor: 'one-minus-src-alpha',
    operation: 'add',
  };
  const upsample = await smokeRender(
    device,
    SMOKE_UPSAMPLE,
    ['uniform', 'color2d', 'depth2d'],
    [{ format: spec.format, blend: { color: blend, alpha: blend } }],
    SMOKE_PASSES[5],
  );
  const marchGroup = smokeGroup(device, march.layout, [{ buffer: r.view }, r.state[0], r.sampler]);
  const upsampleGroup = smokeGroup(device, upsample.layout, [{ buffer: r.view }, r.color, r.depth]);
  const half = Math.sqrt(spec.coverage);
  const values = new Float32Array(32);
  values.set([spec.width, spec.height, r.plan.halfWidth, r.plan.halfHeight], 16);
  values.set([half, half, 0.5, 0], 20);
  values.set([spec.maxSteps, 8, 0.005, spec.grid], 24);
  const marchDescriptor: GPURenderPassDescriptor = {
    label: SMOKE_PASSES[4],
    colorAttachments: [
      { view: r.color, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' },
      { view: r.depth, clearValue: [1e20, 0, 0, 0], loadOp: 'clear', storeOp: 'store' },
    ],
  };
  const outputAttachment: GPURenderPassColorAttachment = {
    view: r.color,
    loadOp: 'load',
    storeOp: 'store',
  };
  const outputDescriptor: GPURenderPassDescriptor = {
    label: SMOKE_PASSES[5],
    colorAttachments: [outputAttachment],
  };
  return (encoder: GPUCommandEncoder, frame: SmokeFrame) => {
    for (let i = 0; i < 16; i++) values[i] = frame.inverseViewProjection[i];
    device.queue.writeBuffer(r.view, 0, values);
    const pass = encoder.beginRenderPass(marchDescriptor);
    const x = Math.floor(((1 - half) * r.plan.halfWidth) / 2);
    const y = Math.floor(((1 - half) * r.plan.halfHeight) / 2);
    pass.setScissorRect(x, y, r.plan.halfWidth - 2 * x, r.plan.halfHeight - 2 * y);
    pass.setPipeline(march.pipeline);
    pass.setBindGroup(0, marchGroup);
    pass.draw(3);
    pass.end();
    outputAttachment.view = frame.outputView;
    const output = encoder.beginRenderPass(outputDescriptor);
    output.setPipeline(upsample.pipeline);
    output.setBindGroup(0, upsampleGroup);
    output.draw(3);
    output.end();
  };
}
