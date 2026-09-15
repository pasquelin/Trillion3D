import test from 'node:test';
import assert from 'node:assert/strict';
import { metricsOf, vertexBytesOf } from './webgpuPagesMetrics.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import { createWebgpuVisState } from './webgpuPagesStateVis.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { referenceVertexBytes } from './bench/oracles/g-octets.mjs';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';

test('textureInFlight, textureSlicesUploaded et textureBytesLastFrame reflètent exactement la pompe, texturePending la file en attente', () => {
  const vis = createWebgpuVisState();
  vis.textureJobs.push({} as TextureJob, {} as TextureJob);
  const rt = {
    run: createWebgpuRunState(),
    gpu: { positionBuffers: new Map() },
    vis,
    timing: {},
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true } },
    lights: { lightsActive: 0, shadowsUpdated: 0 },
    texturePump: { uploaded: 5, skipped: 1, inFlight: 2, slices: 7, bytesLastPass: 123 },
  } as unknown as WebgpuPagesRuntime;

  const metrics = metricsOf(rt);
  assert.equal(metrics.textureUploaded, 5);
  assert.equal(metrics.textureSkipped, 1);
  assert.equal(metrics.textureInFlight, 2);
  assert.equal(metrics.textureSlicesUploaded, 7);
  assert.equal(metrics.textureBytesLastFrame, 123);
  assert.equal(metrics.texturePending, 2);
});

// Comportement 9 : textureLevelsUploaded reflète la pompe, et les métriques d'atlas — octets et
// classes calculés — valent `null` tant qu'un des deux atlas n'est pas prêt.
test('textureLevelsUploaded reflète la pompe ; les métriques d’atlas sont null sans atlas prêt', () => {
  const rt = {
    run: createWebgpuRunState(),
    gpu: { positionBuffers: new Map() },
    vis: createWebgpuVisState(),
    timing: {},
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true } },
    lights: { lightsActive: 0, shadowsUpdated: 0 },
    texturePump: { uploaded: 0, skipped: 0, inFlight: 0, slices: 0, bytesLastPass: 0, levels: 3 },
  } as unknown as WebgpuPagesRuntime;
  const metrics = metricsOf(rt);
  assert.equal(metrics.textureLevelsUploaded, 3);
  assert.equal(metrics.textureAtlasBytesCalculated, null);
  assert.equal(metrics.textureAtlasClassBytesCalculated, null);
  assert.equal(metrics.textureAtlasClassesUsed, null);
});

// Comportement 9 : une fois les deux atlas prêts, les octets et les classes calculées reflètent
// exactement leurs plans — jamais mesurés, toujours la somme et la liste de leurs classes.
test('les métriques d’atlas reflètent les octets et classes calculés une fois les deux atlas prêts', () => {
  const vis = createWebgpuVisState();
  vis.colorAtlas = {
    classes: [{ bytes: 100 }, { bytes: 20 }],
    used: 2,
    bytes: 120,
  } as unknown as typeof vis.colorAtlas;
  vis.dataAtlas = {
    classes: [{ bytes: 50 }, { bytes: 10 }],
    used: 1,
    bytes: 60,
  } as unknown as typeof vis.dataAtlas;
  const rt = {
    run: createWebgpuRunState(),
    gpu: { positionBuffers: new Map() },
    vis,
    timing: {},
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true } },
    lights: { lightsActive: 0, shadowsUpdated: 0 },
    texturePump: { uploaded: 0, skipped: 0, inFlight: 0, slices: 0, bytesLastPass: 0, levels: 0 },
  } as unknown as WebgpuPagesRuntime;
  const metrics = metricsOf(rt);
  assert.equal(metrics.textureAtlasBytesCalculated, 180);
  assert.deepEqual(metrics.textureAtlasClassBytesCalculated, [100, 20, 50, 10]);
  assert.equal(metrics.textureAtlasClassesUsed, 2);
});

// G4 : `vertexBytesOf` lit un total tenu à l'allocation (`gpu.vertexBytes`, incrémenté par
// `ensureWebgpuPositionBuffer` et `prepareWebgpuBlend`) au lieu de resommer, à chaque relevé, tous
// les tampons de positions résidents et tous les maillages transparents. Oracle : la resommation
// complète d'avant le lot G, recopiée telle quelle dans `bench/oracles/g-octets.mjs`.
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
    const gpu = { positionBuffers, vertexBytes: tally } as unknown as Parameters<
      typeof vertexBytesOf
    >[0];
    const blendState = { blendGpu } as unknown as Parameters<typeof referenceVertexBytes>[2];
    assert.equal(
      vertexBytesOf(gpu, vis),
      referenceVertexBytes(gpu, vis, blendState),
      JSON.stringify({ positions, concat, blend }),
    );
  }

  test('aucun tampon résident, aucun maillage transparent : les deux valent zéro', () => {
    scenario([], [undefined, undefined, undefined], []);
  });

  test('des tampons de positions résidents seuls, tailles variées et zéro compris', () => {
    scenario([0, 4096, 12], [undefined, undefined, undefined], []);
  });

  test('les trois tampons concaténés du visbuffer présents ou partiellement absents', () => {
    scenario([1024], [2048, undefined, 512], []);
  });

  test('des maillages transparents avec un canal manquant chacun', () => {
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

  test('un relevé complet avec tampons résidents, visbuffer et maillages transparents ensemble', () => {
    scenario(
      [256, 0, 8192],
      [4096, 4096, 2048],
      [
        [64, 64, 64],
        [0, 0, 0],
      ],
    );
  });

  test('des tailles proches de Number.MAX_SAFE_INTEGER ne divergent pas entre les deux sommes', () => {
    const big = Number.MAX_SAFE_INTEGER / 8;
    scenario([big, big], [big, undefined, undefined], [[big, undefined, undefined]]);
  });
}
