// #1275: what a frame encodes for the pages the GPU draws itself (`freshPass.ts`): one compose over
// the batch buffers, then per pool layer the region cull over every row, dispatched by the counts
// the GPU wrote, and a pass that clears the layer's regions and draws each by its own commands —
// both lists, no viewport; nothing while a tinted layer is read or the GPU does not allocate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { DRAW_INDIRECT_STRIDE } from '../../gpu/draw/draw.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { SHADOW_REGION_INDIRECT_BYTES } from '../../gpu/shadow/batchBudget.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { encodeFreshPages } from './freshPass.ts';
import { FRESH_ARG_WORDS } from './freshWgsl.ts';

const ROWS = 7,
  LAYERS = 2,
  PER_LAYER = Math.floor(MAX_SHADOW_REGIONS / LAYERS);

/** A frame's runtime with a pool of two layers, every resource a named stand-in, and what it
 *  encodes into `calls`. */
function frame(calls: unknown[][]) {
  const named = (name: string) => ({ name }) as unknown as GPUBuffer & { name: string };
  const [cache, position, uv, pageTable, views, kept, zeroFlags] = [0, 1, 2, 3, 4, 5, 6].map((k) =>
    named(`vis ${k}`),
  );
  const lights = {
    store: createSceneLightStore(),
    plan: { gpu: { on: true }, pool: { side: 4, layers: LAYERS } },
    allocation: {
      fresh: (_: unknown, bound: { name: string }[], groups: number) =>
        calls.push(['compose', ...bound.map((buffer) => buffer.name), groups]),
    },
    pageRequests: {
      allocation: {
        seeded: true,
        ...Object.fromEntries(
          ['state', 'drawList', 'freshParams', 'freshArgs'].map((k) => [k, named(k)]),
        ),
        writeFresh: (...args: unknown[]) => calls.push(['params', ...args.slice(0, 4)]),
      },
    },
    shadows: {
      texture: {},
      transmittance: undefined as unknown,
      dataBuffer: named('data'),
      faceUniform: named('faces'),
      passes: [0, 1].map((layer) => ({ label: `layer ${layer}` })),
      depthDraws: () => ({ freshOpaque: 'opaque', freshCutout: 'cutout' }),
      faceGroup: 'face group',
      faceStride: 256,
    },
    cull: {
      kept,
      faceVolumes: named('volumes'),
      indirect: named('indirect'),
      drawUniform: named('draw slots'),
      offsets: named('offsets'),
      encode: (
        _: unknown,
        source: { source?: unknown; base: number },
        run: number,
        first: number,
        faces: number,
        rows: number,
        [buffer, at]: [{ name: string }, number],
      ) => {
        calls.push(['cull', source.source ?? 'every row', source.base, run, first, faces, rows]);
        calls.push(['dispatch', buffer.name, at]);
      },
    },
    pageQuads: {
      encode: (_: unknown, first: number, clears: number, restores: number) => {
        calls.push(['clear', first, clears, restores]);
        return 1;
      },
    },
    spheres: { buffer: named('spheres') },
    mobilityRows: named('mobility'),
    mobility: { hasCutouts: true },
    // Every region's group, made once already (`regionGroups.ts`).
    shadowGroupsKey: [cache, position, uv, pageTable, views, kept, undefined, zeroFlags],
    shadowGroups: Array.from({ length: 2 * MAX_SHADOW_REGIONS }, (_, region) => `group ${region}`),
    shadowRenderPasses: 0,
    shadowDrawCalls: 0,
  };
  const vis = {
    visBindGroupLayout: {},
    concatPos: position,
    concatUv: uv,
    pageTable,
    textures: { color: { views } },
    mapsSampler: {},
    zeroFlags,
  };
  const rt = {
    lights,
    vis,
    gpu: { cache: { buffer: cache } },
    layout: { rows: { packedCount: ROWS } },
    run: { gpuDrawCalls: 0 },
  } as unknown as WebgpuPagesRuntime;
  const encoder = {
    beginRenderPass: (pass: { label: string }) => {
      calls.push(['pass', pass.label]);
      return {
        setPipeline: (pipeline: string) => calls.push(['pipeline', pipeline]),
        setBindGroup: (slot: number, group: string, offsets?: number[]) =>
          calls.push(['group', slot, group, ...(offsets ?? [])]),
        drawIndirect: (buffer: { name: string }, at: number) =>
          calls.push(['draw', buffer.name, at]),
        end: () => calls.push(['end']),
      };
    },
  } as unknown as GPUCommandEncoder;
  return { rt, lights, encoder };
}

test('the GPU composes its pages, culls every row by layer and draws each region by itself', () => {
  const calls: unknown[][] = [],
    { rt, lights, encoder } = frame(calls);
  encodeFreshPages(rt, {} as GPUDevice, encoder);
  const bound = ['data', 'state', 'drawList', 'faces', 'volumes', 'indirect'];
  assert.deepEqual(calls.slice(0, 2), [
    ['params', 4, LAYERS, PER_LAYER, ROWS],
    ['compose', ...bound, 'freshParams', 'freshArgs', 1],
  ]);
  for (let layer = 0; layer < LAYERS; layer++) {
    const first = layer * PER_LAYER;
    // Its cull over every row of the frame, at a uniform slot no batch reaches.
    const cull = calls.findIndex((call) => call[0] === 'cull' && call[4] === first);
    assert.deepEqual(calls.slice(cull, cull + 2), [
      ['cull', 'every row', ROWS, MAX_SHADOW_REGIONS - 1 - layer, first, PER_LAYER, ROWS],
      ['dispatch', 'freshArgs', layer * FRESH_ARG_WORDS * 4],
    ]);
    // Its pass: the regions' pages cleared, then each region's two lists by their own commands.
    const pass = calls.findIndex((call) => call[0] === 'pass' && call[1] === `layer ${layer}`);
    assert.deepEqual(calls[pass + 1], ['clear', first, PER_LAYER, 0]);
    const draws = calls.slice(pass).filter((call) => call[0] === 'draw');
    const expected = [0, DRAW_INDIRECT_STRIDE].flatMap((list) =>
      Array.from({ length: PER_LAYER }, (_, k) => [
        'draw',
        'indirect',
        (first + k) * SHADOW_REGION_INDIRECT_BYTES + list,
      ]),
    );
    assert.deepEqual(draws.slice(0, 2 * PER_LAYER), expected);
    assert.deepEqual(calls[pass + 3], ['group', 0, `group ${first}`]);
    assert.deepEqual(calls[pass + 4], ['group', 1, 'face group', first * 256]);
  }
  assert.equal(calls.filter((call) => call[0] === 'pipeline' && call[1] === 'cutout').length, 2);
  assert.equal(lights.shadowRenderPasses, LAYERS);
  assert.equal(calls.filter((call) => call[0] === 'end').length, LAYERS);
});

test('nothing is drawn by the GPU while a tinted layer is read, or while it does not allocate', () => {
  for (const change of [
    (lights: ReturnType<typeof frame>['lights']) => (lights.shadows.transmittance = {}),
    (lights: ReturnType<typeof frame>['lights']) => (lights.plan.gpu.on = false),
  ]) {
    const calls: unknown[][] = [],
      { rt, lights, encoder } = frame(calls);
    change(lights);
    encodeFreshPages(rt, {} as GPUDevice, encoder);
    assert.deepEqual(calls, []);
  }
});
