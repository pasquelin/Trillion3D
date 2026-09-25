// The WebGPU guide pass: free while no guide is shown, drawn over the display target with the
// unjittered camera — outside temporal accumulation — tested against the opaque depth it never
// writes, and a held frame refused once the page changed its guides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideSet } from './guideSet.ts';
import { createWebgpuGuidePass } from './guidePass.ts';
import { holdWebgpuFrame, keepWebgpuFrame, unsettledMask } from '../webgpu/frame/hold.ts';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';
import {
  GUIDE_UNIFORM_FLOATS,
  REVERSED_NEAR_PLANE,
  jitterDepthSlack,
  writeGuideView,
} from './guideShaders.ts';
import {
  encodeWebgpuGuides,
  guidesMoved,
  guidesShown,
} from '../webgpu/pages/render/encodeGuides.ts';

Object.assign(globalThis, {
  GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8, VERTEX: 32 },
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
});

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
    createBindGroupLayout: note('createBindGroupLayout'),
    createPipelineLayout: note('createPipelineLayout'),
    createRenderPipeline: note('createRenderPipeline'),
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
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4], [0, 0]),
    false,
  );
  guides.lines({ positions: [0, 0, 0, 1, 0, 0] }).setVisible(false);
  assert.equal(
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4], [0, 0]),
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
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4], [0, 0]),
    true,
  );
  const [pipeline] = of('createRenderPipeline')[0] as [GPURenderPipelineDescriptor];
  assert.equal(pipeline.depthStencil, undefined, 'no depth attachment: nothing can write it');
  assert.equal([...pipeline.fragment!.targets][0]?.format, 'rgba8unorm', 'the display target');
  const [descriptor] = of('beginRenderPass')[0] as [GPURenderPassDescriptor];
  const [attachment] = [...descriptor.colorAttachments];
  assert.equal(attachment?.view, color);
  assert.equal(attachment?.loadOp, 'load', 'over the composed image');
  assert.equal(descriptor.depthStencilAttachment, undefined);
  const [group] = of('createBindGroup')[0] as [GPUBindGroupDescriptor];
  assert.equal([...group.entries][1]?.resource, depth, 'the scene depth, read in the shader');
  assert.deepEqual(of('draw')[0], [6, 2], 'one quad per segment');
  pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4], [0, 0]);
  assert.equal(of('createRenderPipeline').length, 1, 'built once');
  assert.equal(of('createBuffer').length, 2, 'uniform and instances, uploaded once');
  assert.equal(of('createBindGroup').length, 1, 'the same depth view keeps its group');
  const resized = { depth: 'resized' } as unknown as GPUTextureView;
  pass.encode(encoder, guides, color, resized, { viewProjection: unjittered }, [8, 4], [0, 0]);
  const [again] = of('createBindGroup')[1] as [GPUBindGroupDescriptor];
  assert.equal([...again.entries][1]?.resource, resized, 'a resized depth is bound anew');
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
      temporal: { frame: { active: true, viewProjection: jittered, jitter: [0.25, -0.125] } },
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
    [0.25, -0.125],
  );
  assert.deepEqual([...(view[2] as Float32Array)], [...expected], 'with the jitter of the depth');
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

/** Reversed depth of a tilted plane at pixel `(x, y)`, the jitter `(jx, jy)` pixels applied. */
const plane =
  (jx = 0, jy = 0) =>
  (x: number, y: number) =>
    0.5 + 0.01 * (x - jx) - 0.03 * (y - jy);

test('the depth slack covers exactly what the jitter moved on a plane, and nothing unjittered', () => {
  const jitter = [-0.375, -0.1];
  const scene = plane(...(jitter as [number, number])),
    guide = plane()(4, 4);
  const slack = jitterDepthSlack(scene, 4, 4, jitter);
  assert.ok(Math.abs(slack - (0.375 * 0.01 + 0.1 * 0.03)) < 1e-12, 'jitter times slope, per axis');
  assert.ok(guide >= scene(4, 4) - slack, 'a guide on the plane passes the test');
  assert.ok(guide < scene(4, 4), 'where the bare test would have hidden it');
  assert.equal(jitterDepthSlack(scene, 4, 4, [0, 0]), 0, 'no jitter, no slack');
  assert.ok(0.4 < scene(4, 4) - slack, 'a guide behind the plane stays hidden');
});

test('a silhouette beside the pixel opens no hole: the gentler side gives the slope', () => {
  const edge = (x: number, y: number) => (x > 4 ? 0.1 : plane()(x, y));
  assert.ok(
    Math.abs(jitterDepthSlack(edge, 4, 4, [0.5, 0]) - 0.5 * 0.01) < 1e-12,
    'the far background right of the pixel is not a slope',
  );
});
