import test from 'node:test';
import assert from 'node:assert/strict';
import { metricsOf, vertexBytesOf } from './webgpuPagesMetrics.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import { createWebgpuVisState } from './webgpuPagesStateVis.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { createWebgpuLightState } from './webgpuPagesStateLights.ts';
import { referenceVertexBytes } from '../../bench/oracles/browser/metriques-octets.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { WebgpuGpuState } from './webgpuPagesStateGpu.ts';

// Synchronous-triangles lot: `drawnTriangles` is copied as-is from `run.drawnTriangles`, without
// the `pending` guard (`gpuFrameActive && !gpuMetricsReady`) that hides `submittedTriangles` — it
// never waited for a GPU readback, so never `null` for lack of time where a cut exists.
test('metricsOf publishes drawnTriangles from run.drawnTriangles, even when submittedTriangles is still pending', () => {
  const run = createWebgpuRunState();
  run.gpuFrameActive = true;
  run.gpuMetricsReady = false; // An image still in flight: submittedTriangles must be null.
  run.drawnTriangles = 4321;
  const rt = {
    run,
    gpu: { positionBuffers: new Map() },
    vis: createWebgpuVisState(),
    timing: {},
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true }, residencySets: { keepCount: 0 } },
    setup: { geometryPool: { slots: 0 }, texturePool: {} },
    lights: createWebgpuLightState(),
  } as unknown as WebgpuPagesRuntime;

  const metrics = metricsOf(rt);
  assert.equal(metrics.drawnTriangles, 4321);
  assert.equal(metrics.submittedTriangles, null, 'witness: the pending guard does hide this one');
});

test("texture metrics are the streamer's, and `null` until it is built", () => {
  const rt = {
    run: createWebgpuRunState(),
    gpu: { positionBuffers: new Map() },
    vis: createWebgpuVisState(),
    timing: {},
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true }, residencySets: { keepCount: 0 } },
    setup: { geometryPool: { slots: 0 }, texturePool: {} },
    lights: createWebgpuLightState(),
  } as unknown as WebgpuPagesRuntime;
  const before = metricsOf(rt) as Record<string, unknown>;
  assert.equal('texturePoolBytes' in before, false, 'no pool: nothing is published, not even zero');
  rt.vis.textures = {
    metrics: () => ({ texturePoolBytes: 512, textureTilesResident: 3, textureLevelReads: null }),
  } as unknown as typeof rt.vis.textures;
  const metrics = metricsOf(rt);
  assert.equal(metrics.texturePoolBytes, 512);
  assert.equal(metrics.textureTilesResident, 3);
  assert.equal(metrics.textureLevelReads, null, 'without a level reader: unmeasured, never zero');
});

// G4: `vertexBytesOf` reads a total held at allocation (`gpu.vertexBytes`, incremented by
// `ensureWebgpuPositionBuffer` and `prepareWebgpuBlend`) instead of resuming, every sample, every
// resident position buffer and every transparent mesh. Oracle: the full resummation from before lot
// G, copied as-is into `../../bench/oracles/browser/metriques-octets.ts`.
{
  function buffer(size: number) {
    return { size } as unknown as GPUBuffer;
  }

  function scenario(
    positions: number[],
    concat: (number | undefined)[],
    blend: (readonly [number | undefined, number | undefined, number | undefined])[],
  ) {
    const positionBuffers = new Map(positions.map((size, i) => [i, buffer(size)]));
    let tally = positions.reduce((a, b) => a + b, 0);
    const vis = {
      concatPos: concat[0] === undefined ? undefined : buffer(concat[0]),
      concatUv: concat[1] === undefined ? undefined : buffer(concat[1]),
      concatNrm: concat[2] === undefined ? undefined : buffer(concat[2]),
    } as unknown as Parameters<typeof vertexBytesOf>[1];
    const blendGpu = blend.map(([index, uv, normal]) => ({
      index: index === undefined ? undefined : buffer(index),
      uv: uv === undefined ? undefined : buffer(uv),
      normal: normal === undefined ? undefined : buffer(normal),
    }));
    for (const [index, uv, normal] of blend) tally += (index ?? 0) + (uv ?? 0) + (normal ?? 0);
    const gpu = { positionBuffers, vertexBytes: tally } as unknown as Pick<
      WebgpuGpuState,
      'positionBuffers' | 'vertexBytes'
    >;
    const blendState = { blendGpu } as unknown as Parameters<typeof referenceVertexBytes>[2];
    assert.equal(
      vertexBytesOf(gpu, vis),
      referenceVertexBytes(gpu, vis, blendState),
      JSON.stringify({ positions, concat, blend }),
    );
  }

  test('no resident buffer, no transparent mesh: both are zero', () => {
    scenario([], [undefined, undefined, undefined], []);
  });

  test('resident position buffers alone, mixed sizes including zero', () => {
    scenario([0, 4096, 12], [undefined, undefined, undefined], []);
  });

  test('the three concatenated visbuffer buffers present or partly missing', () => {
    scenario([1024], [2048, undefined, 512], []);
  });

  test('transparent meshes with one missing channel each', () => {
    scenario(
      [],
      [undefined, undefined, undefined],
      [
        [64, undefined, 32],
        [undefined, 128, undefined],
        [16, 16, 16],
      ],
    );
  });

  test('a complete sample with resident buffers, visbuffer and transparent meshes together', () => {
    scenario(
      [256, 0, 8192],
      [4096, 4096, 2048],
      [
        [64, 64, 64],
        [0, 0, 0],
      ],
    );
  });

  test('sizes near Number.MAX_SAFE_INTEGER do not diverge between the two sums', () => {
    const big = Number.MAX_SAFE_INTEGER / 8;
    scenario([big, big], [big, undefined, undefined], [[big, undefined, undefined]]);
  });
}

test('`lightsSampled` is true only on a moving accumulated frame whose resolve ran sampled', () => {
  const temporal = { frame: { active: true, sampledRank: 3 } };
  const rt = {
    run: createWebgpuRunState(),
    gpu: { positionBuffers: new Map(), temporal },
    vis: createWebgpuVisState(),
    timing: {},
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true }, residencySets: { keepCount: 0 } },
    setup: { geometryPool: { slots: 0 }, texturePool: {} },
    lights: createWebgpuLightState(),
  } as unknown as WebgpuPagesRuntime;
  assert.equal(metricsOf(rt).lightsSampled, false, 'no light lit: nothing was drawn');
  rt.lights.lightsActive = 2;
  assert.equal(metricsOf(rt).lightsSampled, true);
  temporal.frame.sampledRank = 0;
  assert.equal(metricsOf(rt).lightsSampled, false, 'a still frame shades every light');
});
