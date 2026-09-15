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
