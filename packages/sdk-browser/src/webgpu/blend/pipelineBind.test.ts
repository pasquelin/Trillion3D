import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { surfaceOf } from '../../page/surface.ts';
import { drawBlendPass } from './draw.ts';
import { blendLightResources } from './lighting.ts';
import { buildBlendStatics, refreshBlendPlan } from './plan.ts';
import { orderBlendPasses } from './order.ts';
import { createWebgpuBlendState } from './state.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const FRONT = 'front' as unknown as GPURenderPipeline,
  BACK = 'back' as unknown as GPURenderPipeline,
  TEXTURED = 'textured' as unknown as GPURenderPipeline;

/** An already-bound blend item: only the pipeline sequence is observed here. */
const item = (side: number, negatif = false, paged = false) => {
  const matrix = new G.Matrix4();
  if (negatif) matrix.makeScale(-1, 1, 1);
  return {
    surface: surfaceOf(G.basicSurface({ side })),
    matrix,
    count: 3,
    group: {} as GPUBindGroup,
    paged,
  };
};
/** The same item, but paged: it reads concatenated geometry, so it shares draws. */
const pagee = (side: number) => item(side, false, true);

function joue(items: ReturnType<typeof item>[]) {
  const pipelines: unknown[] = [];
  // Rank of the RUN whose indirect argument each draw rereads: one run per draw, and the
  // instances of all its entries in sequence.
  const draws: number[] = [];
  const pass = {
    setViewport() {},
    setBindGroup() {},
    setPipeline(pipeline: unknown) {
      pipelines.push(pipeline);
    },
    drawIndirect(_args: GPUBuffer, offset: number) {
      draws.push(offset / 16);
    },
    end() {},
  };
  // Bind groups are rebuilt on the first pass, when lighting resources enter the key: the stub
  // gives enough for construction to succeed. Pipeline order is no longer decided in the encode
  // loop: it is baked in the static plan, one entry per face, built with the scene. It is therefore
  // built here the way prepare does.
  const blendState = Object.assign(createWebgpuBlendState(), {
    argsBuffer: {} as GPUBuffer,
    itemBuffer: {} as GPUBuffer,
    viewBuffer: {} as GPUBuffer,
  });
  blendState.blendGpu.push(...(items as unknown as (typeof blendState.blendGpu)[number][]));
  buildBlendStatics(blendState);
  refreshBlendPlan(blendState);
  // Frame ranking sets the frustum verdict and slices the plan into runs: it is what decides how
  // many draws the pass encodes. All items are at the same place, so source order breaks them.
  orderBlendPasses(blendState, [0, 0, 0]);
  const rt = {
    vis: {
      visEnabled: true,
      blendPipelines: [TEXTURED, FRONT, BACK],
      blendBindGroupLayout: {},
      textures: {
        color: { views: [{}, {}, {}], pages: { buffer: {} } },
        data: { views: [{}, {}, {}], pages: { buffer: {} } },
        feedback: { buffer: {} },
      },
      mapsSampler: {},
    },
    gpu: {
      hdrView: {},
      colorView: {},
      depthView: {},
      targetSize: [8, 8],
      volumeBuffer: {},
      backdrop: { colorView: {}, depthView: {}, active: false },
      cache: { buffer: {} },
      uniformBuffer: {},
      zeroUv: {},
      deferred: {
        placeholders: { slices: {}, atlasView: {}, sampler: {}, bounceGrid: {}, probes: {} },
      },
    },
    lights: { buffer: {}, shadows: undefined, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    // `lit` view with no light: the contract lights, so the pass binds its default resources.
    sunFar: { gpu: undefined },
    blendState,
    run: {
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendUnpagedTriangles: 0,
      blendPagedTriangles: 0,
      blendSubmittedTriangles: 0,
    },
  } as unknown as WebgpuPagesRuntime;
  // The lighting of the image, resolved once as `encodeBlend` does before any pass.
  blendState.lighting = blendLightResources(rt);
  drawBlendPass(rt, fakeDevice().device, {
    beginRenderPass: () => pass,
  } as unknown as GPUCommandEncoder);
  return { pipelines, draws, calls: rt.run.blendDrawCalls };
}

test('an unpaged item keeps its draw: it carries its own buffers', () => {
  // Five items that are not paged: each reads its indices, positions and UVs, so each keeps its
  // bind group and its draw — one run per entry, as before.
  const suite = joue([
    item(G.FRONT_SIDE),
    item(G.FRONT_SIDE),
    item(G.FRONT_SIDE),
    item(G.BACK_SIDE),
    item(G.BACK_SIDE),
  ]);
  assert.equal(suite.calls, 5, 'one draw per unpaged item');
  assert.deepEqual(suite.draws, [0, 1, 2, 3, 4], 'each draw rereads the argument of ITS run');
  assert.deepEqual(suite.pipelines, [BACK, FRONT], 'one pipeline per change, in order');
});

test('paged items that set the same pipeline fit in ONE draw', () => {
  // That is the whole lot: five paged items in a row, one draw order. They all read the same
  // concatenated geometry and the same page cache, and their instances follow each other in the
  // expanded list, farthest to nearest.
  const fondu = joue([
    pagee(G.FRONT_SIDE),
    pagee(G.FRONT_SIDE),
    pagee(G.FRONT_SIDE),
    pagee(G.FRONT_SIDE),
    pagee(G.FRONT_SIDE),
  ]);
  assert.equal(fondu.calls, 1, 'five items, one draw');
  assert.deepEqual(fondu.draws, [0]);
  assert.deepEqual(fondu.pipelines, [BACK]);

  // Pipeline remains the only break: two faces requested, two runs, and not one more.
  const deuxFaces = joue([pagee(G.FRONT_SIDE), pagee(G.BACK_SIDE), pagee(G.FRONT_SIDE)]);
  assert.equal(deuxFaces.calls, 3, 'the pipeline changes twice, hence three runs');
  assert.deepEqual(deuxFaces.pipelines, [BACK, FRONT, BACK]);
});

test('an unpaged item cuts the run of its paged neighbours', () => {
  // It cannot share their bind group: the run stops on it and restarts after.
  const melange = joue([
    pagee(G.FRONT_SIDE),
    pagee(G.FRONT_SIDE),
    item(G.FRONT_SIDE),
    pagee(G.FRONT_SIDE),
  ]);
  assert.equal(melange.calls, 3, 'paged, the isolated one, paged');
  assert.deepEqual(melange.draws, [0, 1, 2]);
  assert.deepEqual(melange.pipelines, [BACK], 'one pipeline for the three');
});

test('a two-sided unpaged item does set its two pipelines, in blend order', () => {
  const deux = joue([item(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE)]);
  assert.equal(deux.calls, 4, 'two draws per two-sided item');
  // The second item picks up where the first stopped: its first face changes, the second too.
  assert.deepEqual(deux.pipelines, [FRONT, BACK, FRONT, BACK]);

  // A negative determinant swaps the item's two faces: it therefore starts with the one the
  // previous had just set, and only what changes is reset — four draws, three pipelines.
  const renverse = joue([item(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE, true)]);
  assert.equal(renverse.calls, 4);
  assert.deepEqual(renverse.pipelines, [FRONT, BACK, FRONT]);
});

test('two-sided paged items draw back and face in ONE draw, on the pipeline that culls nothing', () => {
  // The vertex stage culls for them (plan.ts, VERTEX CULL): a mirrored matrix swaps their cull
  // modes, not their pipeline, and the whole row still fits in one draw.
  const pages = joue([pagee(G.DOUBLE_SIDE), pagee(G.DOUBLE_SIDE), pagee(G.DOUBLE_SIDE)]);
  assert.equal(pages.calls, 1, 'six entries, one draw');
  assert.deepEqual(pages.pipelines, [TEXTURED]);
  const renverse = joue([pagee(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE, true, true)]);
  assert.equal(renverse.calls, 1);
});
