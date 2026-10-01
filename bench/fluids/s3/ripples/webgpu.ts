import { createRippleModel } from './model.ts';
import { ripplePipelines } from './pipelines.ts';
import { MAX_CATCHUP, type RippleFrame, type RippleSpec } from './types.ts';

/** Encode into the harness' timed encoder, or submit a dedicated encoder when omitted. */
export async function createWebgpuRipples(device: GPUDevice, spec: RippleSpec) {
  const model = createRippleModel(spec),
    n = model.resolution;
  const pipelines = await ripplePipelines(device);
  const textures = [0, 1].map((i) =>
    device.createTexture({
      label: `S3 ripple ${i}`,
      size: [n, n],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC,
    }),
  );
  const views = textures.map((texture) => texture.createView());
  const uniformStride = Math.max(256, device.limits.minUniformBufferOffsetAlignment);
  const uniforms = device.createBuffer({
    size: uniformStride * (MAX_CATCHUP + 1),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const records = device.createBuffer({
    size: model.records.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const extent = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(extent, 0, new Float32Array([model.extent, 0, 0, 0]));
  const groups = views.map((view, i) =>
    device.createBindGroup({
      layout: pipelines.stepLayout,
      entries: [
        { binding: 0, resource: { buffer: uniforms, offset: 0, size: 32 } },
        { binding: 1, resource: view },
        { binding: 2, resource: views[1 - i] },
      ],
    }),
  );
  const splatGroup = device.createBindGroup({
    layout: pipelines.splatLayout,
    entries: [{ binding: 0, resource: { buffer: extent } }],
  });
  const words = new ArrayBuffer(32),
    floats = new Float32Array(words),
    ints = new Int32Array(words);
  let current = 0,
    disposed = false;
  const offsets = new Uint32Array(1);
  const advance = (encoder: GPUCommandEncoder, slot: number, dt: number, x = 0, z = 0) => {
    floats[0] = dt;
    floats[1] = model.dx;
    floats[2] = model.depth;
    floats[3] = Math.exp(-model.damping * dt);
    ints[4] = Math.max(-n, Math.min(n, x));
    ints[5] = Math.max(-n, Math.min(n, z));
    const offset = slot * uniformStride;
    device.queue.writeBuffer(uniforms, offset, words);
    const pass = encoder.beginComputePass({
      label: dt ? 'S3 ripple solve' : 'S3 ripple recenter',
    });
    pass.setPipeline(pipelines.step);
    offsets[0] = offset;
    pass.setBindGroup(0, groups[current], offsets);
    pass.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8));
    pass.end();
    current = 1 - current;
  };
  return {
    resolution: n,
    rate: model.rate,
    bytes: model.stateBytes + model.records.byteLength + uniformStride * (MAX_CATCHUP + 1) + 16,
    texture: () => textures[current],
    step(seconds: number, external?: GPUCommandEncoder, frame?: RippleFrame) {
      if (disposed) throw new Error('Ripple runtime is disposed');
      const work = model.plan(seconds, frame);
      if (!work.steps && !work.splats && !work.recentered) return work;
      const encoder = external ?? device.createCommandEncoder({ label: 'S3 ripple frame' });
      let uniformSlot = 0;
      if (work.recentered) advance(encoder, uniformSlot++, 0, work.shiftX, work.shiftZ);
      if (work.splats) {
        device.queue.writeBuffer(records, 0, model.records, 0, work.splats * 4);
        const pass = encoder.beginRenderPass({
          label: 'S3 ripple splats',
          colorAttachments: [{ view: views[current], loadOp: 'load', storeOp: 'store' }],
        });
        pass.setPipeline(pipelines.inject);
        pass.setBindGroup(0, splatGroup);
        pass.setVertexBuffer(0, records);
        pass.draw(6, work.splats);
        pass.end();
      }
      for (let i = 0; i < work.steps; i++) advance(encoder, uniformSlot++, model.dt);
      if (!external) device.queue.submit([encoder.finish()]);
      return work;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      textures.forEach((texture) => texture.destroy());
      [uniforms, records, extent].forEach((buffer) => buffer.destroy());
    },
  };
}
