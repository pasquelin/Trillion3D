// The WebGPU guide pass: free while no guide is shown, drawn over the display target with the
// unjittered camera — outside temporal accumulation — tested against the opaque depth it never
// writes, and a held frame refused once the page changed its guides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideSet } from './guideSet.ts';
import { createWebgpuGuidePass } from './guidePass.ts';
import { holdWebgpuFrame, keepWebgpuFrame, unsettledMask } from '../webgpu/frame/hold.ts';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';
import { GUIDE_UNIFORM_FLOATS, REVERSED_NEAR_PLANE, writeGuideView } from './guideShaders.ts';
import {
  encodeWebgpuGuides,
  guidesMoved,
  guidesShown,
} from '../webgpu/pages/render/encodeGuides.ts';

Object.assign(globalThis, { GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8, VERTEX: 32 } });

/** A device and an encoder that record what they are asked. */
function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const note =
    (name: string, answer: unknown = {}) =>
    (...args: unknown[]) => (calls.push({ name, args }), answer);
  const pass = {
    setPipeline: note('setPipeline'),
    setBindGroup: note('setBindGroup'),
    setVertexBuffer: note('setVertexBuffer'),
    draw: note('draw'),
    end: note('end'),
  };
  const device = {
    createShaderModule: note('createShaderModule'),
    createRenderPipeline: note('createRenderPipeline', { getBindGroupLayout: () => ({}) }),
    createBuffer: (descriptor: GPUBufferDescriptor) => (
      calls.push({ name: 'createBuffer', args: [descriptor] }),
      { size: descriptor.size, destroy() {} }
    ),
    createBindGroup: note('createBindGroup'),
    queue: { writeBuffer: note('writeBuffer') },
  } as unknown as GPUDevice;
  const encoder = {
    beginRenderPass: note('beginRenderPass', pass),
  } as unknown as GPUCommandEncoder;
  const of = (name: string) => calls.filter((call) => call.name === name).map((call) => call.args);
  return { device, encoder, of };
}

const unjittered = Float64Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
  jittered = Float64Array.from(unjittered, (v, i) => (i === 8 ? 0.25 : v));
const color = { color: true } as unknown as GPUTextureView,
  depth = { depth: true } as unknown as GPUTextureView,
  hdr = { hdr: true } as unknown as GPUTextureView;

test('a world that shows no guide builds nothing and encodes no pass', () => {
  const { device, encoder, of } = recorder();
  const guides = createGuideSet(),
    pass = createWebgpuGuidePass(device);
  assert.equal(
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4]),
    false,
  );
  guides.lines({ positions: [0, 0, 0, 1, 0, 0] }).setVisible(false);
  assert.equal(
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4]),
    false,
  );
  for (const name of ['createRenderPipeline', 'createBuffer', 'writeBuffer', 'beginRenderPass'])
    assert.equal(of(name).length, 0, name);
});

test('guides draw over the display target, depth read and never written', () => {
  const { device, encoder, of } = recorder();
  const guides = createGuideSet(),
    pass = createWebgpuGuidePass(device);
  guides.lines({ positions: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0] });
  assert.equal(
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4]),
    true,
  );
  const [pipeline] = of('createRenderPipeline')[0] as [GPURenderPipelineDescriptor];
  assert.equal(pipeline.depthStencil?.depthWriteEnabled, false);
  assert.equal(pipeline.depthStencil?.depthCompare, 'greater-equal', 'the reversed depth');
  assert.equal([...pipeline.fragment!.targets][0]?.format, 'rgba8unorm', 'the display target');
  const [descriptor] = of('beginRenderPass')[0] as [GPURenderPassDescriptor];
  const [attachment] = [...descriptor.colorAttachments];
  assert.equal(attachment?.view, color);
  assert.equal(attachment?.loadOp, 'load', 'over the composed image');
  assert.deepEqual(descriptor.depthStencilAttachment, { view: depth, depthReadOnly: true });
  assert.deepEqual(of('draw')[0], [6, 2], 'one quad per segment');
  pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4]);
  assert.equal(of('createRenderPipeline').length, 1, 'built once');
  assert.equal(of('createBuffer').length, 2, 'uniform and instances, uploaded once');
});

test('the pass draws with the camera, not the jittered matrix of temporal accumulation', () => {
  const { device, encoder, of } = recorder();
  const guides = createGuideSet();
  const rt = {
    context: { guides },
    gpu: {
      colorView: color,
      depthView: depth,
      hdrView: hdr,
      targetSize: [8, 4],
      guides: undefined,
      guideRevision: 0,
      temporal: { frame: { viewProjection: jittered } },
    },
    run: { gpuDrawCalls: 0 },
  } as never as Parameters<typeof guidesShown>[0];
  guides.points({ positions: [0, 0, -2] });
  assert.equal(guidesMoved(rt), true, 'a change the last image did not draw');
  assert.equal(guidesShown(rt), true);
  assert.equal(guidesMoved(rt), false, 'the image about to be encoded draws it');
  encodeWebgpuGuides(rt, device, encoder, { viewProjection: unjittered } as never);
  const view = of('writeBuffer').find(
    ([, , data]) => (data as Float32Array).length === GUIDE_UNIFORM_FLOATS,
  )!;
  const expected = writeGuideView(
    new Float32Array(GUIDE_UNIFORM_FLOATS),
    unjittered,
    [0, 0, 0],
    8,
    4,
    REVERSED_NEAR_PLANE,
  );
  assert.deepEqual([...(view[2] as Float32Array)], [...expected]);
  const [descriptor] = of('beginRenderPass')[0] as [GPURenderPassDescriptor];
  assert.notEqual([...descriptor.colorAttachments][0]?.view, hdr, 'never the image history reads');
  assert.equal(rt.run.gpuDrawCalls, 1);
});

test('a session without guides reads nothing and holds as before', () => {
  const rt = { context: {}, gpu: { guideRevision: 0 } } as never as Parameters<
    typeof guidesShown
  >[0];
  assert.equal(guidesShown(rt), false);
  assert.equal(guidesMoved(rt), false);
});

test('a guide changed on a held image releases it, and leaves the accumulation still', () => {
  const rt = settledRt();
  const guides = createGuideSet();
  rt.context.guides = guides;
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  const device = {} as GPUDevice;
  assert.equal(holdWebgpuFrame(rt, device), true, 'no guide yet: the image is held');
  guides.lines({ positions: [0, 0, 0, 1, 0, 0] });
  assert.equal(unsettledMask(rt), 0, 'a guide moves nothing temporal accumulation reads');
  assert.equal(holdWebgpuFrame(rt, device), false, 'the next image draws the guide');
  guidesShown(rt as never);
  assert.equal(holdWebgpuFrame(rt, device), true, 'drawn once, held again');
});
