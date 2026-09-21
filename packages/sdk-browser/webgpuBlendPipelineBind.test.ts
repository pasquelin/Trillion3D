import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { blendLightResources } from './webgpuBlendLighting.ts';
import { buildBlendStatics, refreshBlendPlan } from './webgpuBlendPlan.ts';
import { orderBlendPasses } from './webgpuBlendOrder.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const FRONT = 'front' as unknown as GPURenderPipeline,
  BACK = 'back' as unknown as GPURenderPipeline,
  TEXTURED = 'textured' as unknown as GPURenderPipeline;

/** An already-bound blend item: only the pipeline sequence is observed here. */
const item = (side: THREE.Side, negatif = false, paged = false) => {
  const matrix = new THREE.Matrix4();
  if (negatif) matrix.makeScale(-1, 1, 1);
  return {
    material: new THREE.MeshBasicMaterial({ side }),
    matrix,
    count: 3,
    group: {} as GPUBindGroup,
    paged,
  };
};
/** The same item, but paged: it reads concatenated geometry, so it shares draws. */
const pagee = (side: THREE.Side) => item(side, false, true);

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
  drawBlendPass(
    rt,
    { createBindGroup: () => ({}) } as unknown as GPUDevice,
    { beginRenderPass: () => pass } as unknown as GPUCommandEncoder,
  );
  return { pipelines, draws, calls: rt.run.blendDrawCalls };
}

test('an unpaged item keeps its draw: it carries its own buffers', () => {
  // Five items that are not paged: each reads its indices, positions and UVs, so each keeps its
  // bind group and its draw — one run per entry, as before.
  const suite = joue([
    item(THREE.FrontSide),
    item(THREE.FrontSide),
    item(THREE.FrontSide),
    item(THREE.BackSide),
    item(THREE.BackSide),
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
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
  ]);
  assert.equal(fondu.calls, 1, 'five items, one draw');
  assert.deepEqual(fondu.draws, [0]);
  assert.deepEqual(fondu.pipelines, [BACK]);

  // Pipeline remains the only break: two faces requested, two runs, and not one more.
  const deuxFaces = joue([pagee(THREE.FrontSide), pagee(THREE.BackSide), pagee(THREE.FrontSide)]);
  assert.equal(deuxFaces.calls, 3, 'the pipeline changes twice, hence three runs');
  assert.deepEqual(deuxFaces.pipelines, [BACK, FRONT, BACK]);
});

test('an unpaged item cuts the run of its paged neighbours', () => {
  // It cannot share their bind group: the run stops on it and restarts after.
  const melange = joue([
    pagee(THREE.FrontSide),
    pagee(THREE.FrontSide),
    item(THREE.FrontSide),
    pagee(THREE.FrontSide),
  ]);
  assert.equal(melange.calls, 3, 'paged, the isolated one, paged');
  assert.deepEqual(melange.draws, [0, 1, 2]);
  assert.deepEqual(melange.pipelines, [BACK], 'one pipeline for the three');
});

test('a two-sided item does set its two pipelines, in blend order', () => {
  const deux = joue([item(THREE.DoubleSide), item(THREE.DoubleSide)]);
  assert.equal(deux.calls, 4, 'two draws per two-sided item');
  // The second item picks up where the first stopped: its first face changes, the second too.
  assert.deepEqual(deux.pipelines, [FRONT, BACK, FRONT, BACK]);

  // A negative determinant swaps the item's two faces: it therefore starts with the one the
  // previous had just set, and only what changes is reset — four draws, three pipelines.
  const renverse = joue([item(THREE.DoubleSide), item(THREE.DoubleSide, true)]);
  assert.equal(renverse.calls, 4);
  assert.deepEqual(renverse.pipelines, [FRONT, BACK, FRONT]);
});
