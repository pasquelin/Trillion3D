// The WebGPU guide pass: free while no guide is shown, drawn over the display target with the
// unjittered camera — outside temporal accumulation — tested against the opaque depth it never
// writes, and a held frame refused once the page changed its guides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideSet } from './guideSet.ts';
import { createWebgpuGuidePass } from './guidePass.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { holdWebgpuFrame, keepWebgpuFrame, unsettledMask } from '../webgpu/frame/hold.ts';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';
import { GUIDE_UNIFORM_FLOATS, writeGuideView } from './guideShaders.ts';
import {
  encodeWebgpuGuides,
  guidesMoved,
  guidesShown,
} from '../webgpu/pages/render/encodeGuides.ts';

/** The kit's recording device, and an encoder whose render passes record what they are asked. */
function recorder() {
  const gpu = fakeDevice(),
    passes: GPURenderPassDescriptor[] = [],
    draws: number[][] = [];
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    draw: (...args: number[]) => void draws.push(args),
    end() {},
  };
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => (passes.push(descriptor), pass),
  } as unknown as GPUCommandEncoder;
  return { ...gpu, encoder, passes, draws };
}

const unjittered = Float64Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
  jittered = Float64Array.from(unjittered, (v, i) => (i === 8 ? 0.25 : v));
const color = { color: true } as unknown as GPUTextureView,
  depth = { depth: true } as unknown as GPUTextureView,
  hdr = { hdr: true } as unknown as GPUTextureView;

test('a world that shows no guide builds nothing and encodes no pass', () => {
  const { device, encoder, renderPipelines, buffers, writes, passes } = recorder();
  const guides = createGuideSet(),
    pass = createWebgpuGuidePass(device);
  assert.equal(
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4], 1, [0, 0]),
    false,
  );
  guides.lines({ positions: [0, 0, 0, 1, 0, 0] }).setVisible(false);
  assert.equal(
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4], 1, [0, 0]),
    false,
  );
  for (const made of [renderPipelines, buffers, writes, passes]) assert.equal(made.length, 0);
});

test('guides draw over the display target, depth read and never written', () => {
  const { device, encoder, renderPipelines, buffers, bindGroups, passes, draws } = recorder();
  const guides = createGuideSet(),
    pass = createWebgpuGuidePass(device);
  guides.lines({ positions: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0] });
  assert.equal(
    pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4], 1, [0, 0]),
    true,
  );
  const [pipeline] = renderPipelines;
  assert.equal(pipeline.depthStencil, undefined, 'no depth attachment: nothing can write it');
  assert.equal([...pipeline.fragment!.targets][0]?.format, 'rgba8unorm', 'the display target');
  const [descriptor] = passes;
  const [attachment] = [...descriptor.colorAttachments];
  assert.equal(attachment?.view, color);
  assert.equal(attachment?.loadOp, 'load', 'over the composed image');
  assert.equal(descriptor.depthStencilAttachment, undefined);
  const [group] = bindGroups;
  assert.equal([...group.entries][1]?.resource, depth, 'the scene depth, read in the shader');
  assert.deepEqual(draws[0], [6, 2], 'one quad per segment');
  pass.encode(encoder, guides, color, depth, { viewProjection: unjittered }, [8, 4], 1, [0, 0]);
  assert.equal(renderPipelines.length, 1, 'built once');
  assert.equal(buffers.length, 2, 'uniform and instances, uploaded once');
  assert.equal(bindGroups.length, 1, 'the same depth view keeps its group');
  const resized = { depth: 'resized' } as unknown as GPUTextureView;
  pass.encode(encoder, guides, color, resized, { viewProjection: unjittered }, [8, 4], 1, [0, 0]);
  const again = bindGroups[1];
  assert.equal([...again.entries][1]?.resource, resized, 'a resized depth is bound anew');
});

test('the pass draws with the camera, not the jittered matrix of temporal accumulation', () => {
  const { device, encoder, writes, passes } = recorder();
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
    setup: { pixelRatio: () => 2 },
  } as never as Parameters<typeof guidesShown>[0];
  guides.points({ positions: [0, 0, -2] });
  assert.equal(guidesMoved(rt), true, 'a change the last image did not draw');
  assert.equal(guidesShown(rt), true);
  assert.equal(guidesMoved(rt), false, 'the image about to be encoded draws it');
  encodeWebgpuGuides(rt, device, encoder, { viewProjection: unjittered } as never);
  const view = writes.find(({ data }) => data.length === GUIDE_UNIFORM_FLOATS)!;
  const expected = writeGuideView(
    new Float32Array(GUIDE_UNIFORM_FLOATS),
    unjittered,
    [0, 0, 0],
    8,
    4,
    2,
    [0.25, -0.125],
  );
  assert.deepEqual(
    [...view.data],
    [...expected],
    "with the jitter of the depth, at the host's pixel ratio",
  );
  const [descriptor] = passes;
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
