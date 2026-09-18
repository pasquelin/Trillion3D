import test from 'node:test';
import assert from 'node:assert/strict';
import { metricsOf, vertexBytesOf } from './webgpuPagesMetrics.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import { createWebgpuVisState } from './webgpuPagesStateVis.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { createWebgpuLightState } from './webgpuPagesStateLights.ts';
import { referenceVertexBytes } from './bench/oracles/metriques-octets.mjs';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

// Lot triangles synchrones : `drawnTriangles` est recopié tel quel depuis `run.drawnTriangles`, sans
// la garde `pending` (`gpuFrameActive && !gpuMetricsReady`) qui masque `submittedTriangles` — il n'a
// jamais attendu de retour de la carte, donc jamais `null` faute de temps là où une coupe existe.
test('metricsOf publie drawnTriangles depuis run.drawnTriangles, même quand submittedTriangles est encore en attente', () => {
  const run = createWebgpuRunState();
  run.gpuFrameActive = true;
  run.gpuMetricsReady = false; // Une image encore en vol : submittedTriangles doit valoir null.
  run.drawnTriangles = 4321;
  const rt = {
    run,
    gpu: { positionBuffers: new Map() },
    vis: createWebgpuVisState(),
    timing: {},
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true } },
    setup: { frameBudget: 0 },
    lights: createWebgpuLightState(),
  } as unknown as WebgpuPagesRuntime;

  const metrics = metricsOf(rt);
  assert.equal(metrics.drawnTriangles, 4321);
  assert.equal(metrics.submittedTriangles, null, 'témoin : la garde pending masque bien celui-ci');
});

test('les métriques de textures sont celles du diffuseur, et `null` tant qu’il n’est pas bâti', () => {
  const rt = {
    run: createWebgpuRunState(),
    gpu: { positionBuffers: new Map() },
    vis: createWebgpuVisState(),
    timing: {},
    blendState: createWebgpuBlendState(),
    services: { bootstrapState: { ready: true } },
    setup: { frameBudget: 0 },
    lights: createWebgpuLightState(),
  } as unknown as WebgpuPagesRuntime;
  const before = metricsOf(rt) as Record<string, unknown>;
  assert.equal(
    'texturePoolBytes' in before,
    false,
    'aucun pool : rien n’est publié, pas même zéro',
  );
  rt.vis.textures = {
    metrics: () => ({ texturePoolBytes: 512, textureTilesResident: 3, textureLevelReads: null }),
  } as unknown as typeof rt.vis.textures;
  const metrics = metricsOf(rt);
  assert.equal(metrics.texturePoolBytes, 512);
  assert.equal(metrics.textureTilesResident, 3);
  assert.equal(
    metrics.textureLevelReads,
    null,
    'sans lecteur de niveaux : non mesuré, jamais zéro',
  );
});

// G4 : `vertexBytesOf` lit un total tenu à l'allocation (`gpu.vertexBytes`, incrémenté par
// `ensureWebgpuPositionBuffer` et `prepareWebgpuBlend`) au lieu de resommer, à chaque relevé, tous
// les tampons de positions résidents et tous les maillages transparents. Oracle : la resommation
// complète d'avant le lot G, recopiée telle quelle dans `bench/oracles/metriques-octets.mjs`.
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
