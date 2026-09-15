import test from 'node:test';
import assert from 'node:assert/strict';
import { metricsOf } from './webgpuPagesMetrics.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import { createWebgpuVisState } from './webgpuPagesStateVis.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
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
