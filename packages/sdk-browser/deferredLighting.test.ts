import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredLighting } from './deferredLighting.ts';
import type { SurfaceBuffer } from './surfaceBuffer.ts';

function gpuHarness() {
  Object.assign(globalThis, {
    GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 },
    GPUShaderStage: { FRAGMENT: 2 },
    GPUTextureUsage: { TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 },
  });
  const pipelines = new Map<GPURenderPipeline, GPURenderPipelineDescriptor>();
  const passes: {
    descriptor: GPURenderPassDescriptor;
    pipeline?: GPURenderPipeline;
    draws: number[];
    ended: boolean;
  }[] = [];
  const writes: Float32Array[] = [];
  let destroyed = false;
  const uniform = {
    destroy() {
      destroyed = true;
    },
  } as GPUBuffer;
  const device = {
    createBuffer() {
      return uniform;
    },
    createShaderModule() {
      return { getCompilationInfo: async () => ({ messages: [] }) } as unknown as GPUShaderModule;
    },
    createBindGroupLayout() {
      return {} as GPUBindGroupLayout;
    },
    createTexture() {
      return { createView: () => ({}) as GPUTextureView, destroy() {} } as unknown as GPUTexture;
    },
    createSampler() {
      return {} as GPUSampler;
    },
    createPipelineLayout() {
      return {} as GPUPipelineLayout;
    },
    async createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor) {
      const pipeline = {} as GPURenderPipeline;
      pipelines.set(pipeline, descriptor);
      return pipeline;
    },
    createBindGroup() {
      return {} as GPUBindGroup;
    },
    queue: {
      writeBuffer(_buffer: GPUBuffer, _offset: number, data: Float32Array) {
        writes.push(data.slice());
      },
    },
  } as unknown as GPUDevice;
  const encoder = {
    beginRenderPass(descriptor: GPURenderPassDescriptor) {
      const record: {
        descriptor: GPURenderPassDescriptor;
        pipeline?: GPURenderPipeline;
        draws: number[];
        ended: boolean;
      } = { descriptor, draws: [], ended: false };
      passes.push(record);
      return {
        setPipeline(pipeline: GPURenderPipeline) {
          record.pipeline = pipeline;
        },
        setBindGroup() {},
        draw(vertices: number) {
          record.draws.push(vertices);
        },
        end() {
          record.ended = true;
        },
      };
    },
  } as unknown as GPUCommandEncoder;
  const view = () => ({}) as GPUTextureView;
  const surface = { views: () => [view(), view(), view(), view()] } as unknown as SurfaceBuffer;
  return {
    device,
    encoder,
    view,
    surface,
    pipelines,
    passes,
    writes,
    get destroyed() {
      return destroyed;
    },
  };
}

test('composition presents and preserves the capture target in one fullscreen draw', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device, {} as GPUBuffer, {} as GPUBuffer);
  const capture = h.view(),
    presentation = h.view(),
    clear: GPUColor = [0.1, 0.2, 0.3, 1];
  lighting.bind(h.surface, h.view(), h.view());
  lighting.compose(h.encoder, capture, clear, presentation);
  assert.equal(h.passes.length, 1);
  const pass = h.passes[0],
    attachments = Array.from(pass.descriptor.colorAttachments);
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0]!.view, capture);
  assert.equal(attachments[1]!.view, presentation);
  assert.ok(
    attachments.every((attachment) => attachment!.storeOp === 'store'),
    'both images must survive the composition pass',
  );
  assert.deepEqual(pass.draws, [3]);
  assert.equal(pass.ended, true);
  const descriptor = h.pipelines.get(pass.pipeline!)!;
  assert.deepEqual(
    Array.from(descriptor.fragment!.targets).map((target) => target!.format),
    ['rgba8unorm', 'bgra8unorm'],
  );
  assert.ok(
    Array.from(descriptor.fragment!.targets).every((target) => !target!.blend),
    'no additional blending may change either output',
  );
  lighting.dispose();
});

test('composition without presentation keeps its capture-only output and clear color', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device, {} as GPUBuffer, {} as GPUBuffer);
  const capture = h.view(),
    clear: GPUColor = [0.1, 0.2, 0.3, 1];
  lighting.bind(h.surface, h.view(), h.view());
  lighting.compose(h.encoder, capture, clear);
  assert.equal(h.passes.length, 1);
  const pass = h.passes[0];
  assert.deepEqual(Array.from(pass.descriptor.colorAttachments), [
    { view: capture, loadOp: 'clear', storeOp: 'store', clearValue: clear },
  ]);
  assert.deepEqual(
    Array.from(h.pipelines.get(pass.pipeline!)!.fragment!.targets).map((target) => target!.format),
    ['rgba8unorm'],
  );
  assert.deepEqual(pass.draws, [3]);
  assert.equal(pass.ended, true);
  lighting.dispose();
});

test('diagnostic composition retains the display-space flag and unbound calls fail before encoding', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device, {} as GPUBuffer, {} as GPUBuffer),
    target = h.view();
  assert.throws(
    () => lighting.compose(h.encoder, target, [0, 0, 0, 1], h.view()),
    /SURFACE_NOT_BOUND/,
  );
  assert.equal(h.passes.length, 0);
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  lighting.update(matrix, [1, 2, 3], 800, 600, 0x204060, true);
  assert.deepEqual([...h.writes[0].slice(20, 24)], [800, 600, 1, 0]);
  lighting.update(matrix, [1, 2, 3], 800, 600, 0x204060, false);
  assert.deepEqual([...h.writes[1].slice(20, 24)], [800, 600, 0, 0]);
  lighting.bind(h.surface, h.view(), h.view());
  lighting.dispose();
  assert.equal(h.destroyed, true);
  assert.throws(
    () => lighting.compose(h.encoder, target, [0, 0, 0, 1], h.view()),
    /SURFACE_NOT_BOUND/,
  );
  assert.equal(h.passes.length, 0);
});
