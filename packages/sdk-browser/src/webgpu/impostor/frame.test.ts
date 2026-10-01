// #1335: on WebGPU, a root the impostor plan switches draws its card through the card pipeline, and
// the cut drops its clusters in the same image: plan and draw agree. The card waits for its atlas,
// read through the engine's one level reader, and until then the root keeps its clusters — no hole.
// Fails on develop: the WebGPU card pass, its atlas feed and this file are new.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import type { ImpostorSection } from '../../../../sdk-core/src/index.ts';
import { collectClusterPages, selectVisiblePages } from '../../page/selection/selection.ts';
import { dagFixture, frontCamera } from '../../page/selection/dag.fixture.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { impostorCardCorners } from '../../impostor/card.ts';
import type { TextureLevelReader, TextureLevelRequest } from '../../texture/levelReader.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { CARD_FLOATS } from './cardWgsl.ts';
import { encodeImpostorCards, parkSwitchedRoots } from './encode.ts';
import { planWebgpuImpostors } from './frame.ts';
import { IMPOSTOR_PASS } from './pass.ts';

const VIEWPORT: [number, number] = [1280, 720];
/** Deliberately not the root's rank: the card names the mesh, the cut reads the rank. */
const MESH = 3;
const level = (name: string) => ({
  url: `../../objects/${name}.png`,
  sha256: name.repeat(64),
  bytes: 64,
  width: 8,
  height: 8,
});
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: 1117,
  textureLimit: 8192,
  baked: 1,
  refused: 0,
  meshes: [
    {
      ...{ mesh: MESH, sourceMesh: MESH, name: 'fixture', placements: 1, masked: false },
      ...{ rootTriangles: 100, radius: 1, status: 'baked', coverage: 0.5, hemi: false },
      ...{ frames: 12, frameSide: 64, atlasSide: 768, objectRadius: 1 },
      switchDepth: { texel: 0, triangles: 0 },
      maps: {
        colourCoverage: { kind: 'coverage', levels: [level('a')] },
        normalDepth: { kind: 'data', levels: [level('b')] },
        orm: { kind: 'data', levels: [level('c')] },
      },
    },
  ],
};

/** A WebGPU runtime reduced to what the plan and the card pass read, on a recording device. */
function bench() {
  const gpu = fakeDevice();
  const asked: TextureLevelRequest[] = [];
  const reader = (async (request: TextureLevelRequest) => {
    asked.push(request);
    return { width: 8, height: 8, close() {} } as ImageBitmap;
  }) as TextureLevelReader;
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  for (const root of roots) root.mesh = MESH;
  const parked: Array<[number, boolean]> = [];
  let landed = 0;
  const rt = {
    context: { metadata: { impostors: section }, readTextureLevel: reader },
    vis: { visEnabled: true },
    setup: { viewport: VIEWPORT },
    gpu: {
      device: gpu.device,
      impostors: undefined,
      targetSize: VIEWPORT,
      depthView: { label: 'depth' },
      surfaces: { views: () => [0, 1, 2, 3].map((label) => ({ label })) },
    },
    run: {
      gate: { resourcesChanged: () => landed++, cam: createEngineCamera() },
      gpuDrawCalls: 0,
      gpuSelection: { parkWorld: (rank: number, park: boolean) => parked.push([rank, park]) },
    },
  } as unknown as WebgpuPagesRuntime;
  return { gpu, rt, roots, fixture, asked, parked, landed: () => landed };
}

/** An encoder that records the render passes and what each one draws. */
function recordingEncoder() {
  const passes: Array<{
    label?: string;
    pipeline?: unknown;
    groups: unknown[];
    draws: number[][];
  }> = [];
  const encoder = {
    beginRenderPass(descriptor: GPURenderPassDescriptor) {
      const pass = { label: descriptor.label, groups: [] as unknown[], draws: [] as number[][] };
      passes.push(pass as (typeof passes)[number]);
      return {
        setViewport() {},
        setPipeline: (pipeline: unknown) => void Object.assign(pass, { pipeline }),
        setBindGroup: (index: number, group: unknown) => void (pass.groups[index] = group),
        draw: (...args: number[]) => void pass.draws.push(args),
        end() {},
      };
    },
  };
  return { encoder: encoder as unknown as GPUCommandEncoder, passes };
}

const engineOf = (z: number) => readCameraWorld(createEngineCamera(), frontCamera(z, 5000));
const cut = (roots: ReturnType<typeof bench>['roots'], z: number, switched?: Uint8Array) =>
  selectVisiblePages(roots, engineOf(z), { pixelError: 0, viewport: VIEWPORT, switched });

test('a switched root draws its card through the card pipeline once its atlas lands', async () => {
  const { gpu, rt, roots, fixture, asked, parked, landed } = bench();
  const far = engineOf(200);
  // First image: the atlas is asked through the one reader, and the root keeps its clusters.
  const waiting = planWebgpuImpostors(rt, far, roots);
  assert.deepEqual([...waiting!], [0], 'no card before the atlas: the root stays whole');
  assert.ok(cut(roots, 200, waiting).shown.length > 0, 'no hole while the atlas streams');
  assert.deepEqual(
    asked.map((request) => request.url),
    ['a', 'b', 'c'].map((name) => `../../objects/${name}.png`),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(landed(), 1, 'the landing breaks a held image');
  const atlas = gpu.textures.filter((texture) => texture.label?.includes('impostor'));
  assert.deepEqual(
    atlas.map((texture) => texture.format),
    ['rgba8unorm-srgb', 'rgba8unorm', 'rgba8unorm'],
  );
  assert.equal(gpu.imageCopies.length, 3, 'each map copied once to the GPU');
  // Second image: the plan switches the root, the cut drops its clusters, the card is written.
  const switched = planWebgpuImpostors(rt, far, roots)!;
  assert.deepEqual([...switched], [1]);
  assert.deepEqual(cut(roots, 200, rt.gpu.impostors?.switched).shown, [], 'the cut skips it');
  parkSwitchedRoots(rt, roots, switched);
  assert.deepEqual(parked, [[0, true]], 'the GPU cut parks it in the same image');
  const state = rt.gpu.impostors!;
  assert.equal(state.count, 1);
  // The card's corners are the shared sprite basis at the root's pivot, half-extent R.
  const corners = impostorCardCorners(new Float64Array(12), far.viewProjection, [0, 0, 0], 1);
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(state.records[i * 4 + k] - corners[i * 3 + k]) < 1e-5, `corner ${i}`);
  const { encoder, passes } = recordingEncoder();
  encodeImpostorCards(rt, gpu.device, encoder);
  assert.equal(passes.length, 1);
  const [pass] = passes;
  assert.equal(pass.label, IMPOSTOR_PASS);
  const pipeline = pass.pipeline as GPURenderPipelineDescriptor;
  assert.equal(pipeline.vertex.entryPoint, 'card_vs');
  assert.equal(pipeline.depthStencil?.depthCompare, 'greater', 'depth-tested as the clusters');
  assert.equal(pass.groups[1], state.runs[0].group, "the mesh's atlas group");
  assert.deepEqual(pass.draws, [[6, 1, 0, 0]], 'one quad, one instance');
  const written = gpu.writes.find((write) => write.buffer.label === 'Trillion3D impostor cards');
  assert.equal(written?.size, CARD_FLOATS, 'the one card record goes up');
  fixture.geometry.dispose();
});

test('a near root draws whole and no card pass is encoded', async () => {
  const { rt, roots, fixture } = bench();
  planWebgpuImpostors(rt, engineOf(200), roots);
  await new Promise((resolve) => setImmediate(resolve));
  const switched = planWebgpuImpostors(rt, engineOf(5), roots);
  assert.deepEqual([...switched!], [0]);
  assert.ok(cut(roots, 5, switched).shown.length > 0);
  const { encoder, passes } = recordingEncoder();
  encodeImpostorCards(rt, rt.gpu.device!, encoder);
  assert.deepEqual(passes, [], 'no card, no pass');
  fixture.geometry.dispose();
});
