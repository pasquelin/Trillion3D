// #1275: what a frame encodes for the pages the GPU draws itself (`freshPass.ts`): one compose,
// one pair cull dispatched by the arguments it wrote, one seal, then per pool layer one pass that
// clears the layer's pages and draws every kept pair — two indirect draws whatever the pages —,
// and the tinted layer's pass beside it while one is read; nothing in a frame with nothing new to
// draw, or while the GPU does not allocate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { LAMP } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { encodeFreshPages } from './freshPass.ts';
import { FRESH_CASTERS, FRESH_CLEAR, freshDrawWord } from './freshLayout.ts';

const LAYERS = 2;

/** A frame's runtime with a pool of two layers, every resource a named stand-in, and what it
 *  encodes into `calls`. */
function frame(calls: unknown[][]) {
  const named = (name: string) => ({ name, size: 800 }) as unknown as GPUBuffer & { name: string };
  const [cache, position, uv, pageTable, views, kept] = [0, 1, 2, 3, 4, 5].map((k) =>
    named(`vis ${k}`),
  );
  const pass = (name: string) => (_: unknown, bound: { name: string }[], groups: unknown) =>
    calls.push([name, ...bound.map((buffer) => buffer.name), groups]);
  const buffers = ['state', 'drawList', 'freshFaces', 'freshVolumes', 'freshArgs', 'freshParams'];
  const lights = {
    store: createSceneLightStore(),
    plan: {
      gpu: { on: true, listed: 0 },
      resting: false,
      pool: { side: 4, layers: LAYERS },
    },
    allocation: { compose: pass('compose'), cull: pass('cull'), seal: pass('seal') },
    pageRequests: {
      allocation: {
        seeded: true,
        lost: 0,
        ...Object.fromEntries(buffers.map((k) => [k, named(k)])),
        writeFresh: (...args: unknown[]) => calls.push(['params', ...args.slice(0, 5)]),
      },
    },
    shadows: {
      texture: {},
      transmittance: undefined as unknown,
      dataBuffer: named('data'),
      passes: [0, 1].map((layer) => ({ label: `layer ${layer}` })),
      targets: ['view 0', 'view 1'],
      freshDraws: {
        pageLayout: 'page',
        poolLayout: 'pool',
        tintLayout: 'tint',
        made: () =>
          Object.fromEntries(
            ['clear', 'casters', 'tintClear', 'tintDepth', 'tintColour'].map((k) => [k, k]),
          ),
      },
      faceGroup: 'face group',
    },
    cull: { kept, drawUniform: named('draw slots'), offsets: named('offsets') },
    spheres: { buffer: named('spheres') },
    mobilityRows: named('mobility'),
    shadowRenderPasses: 0,
    shadowDrawCalls: 0,
  };
  const vis = {
    ...{ concatPos: position, concatUv: uv, pageTable, textures: { color: { views } } },
    mapsSampler: {},
  };
  const rt = {
    lights,
    vis,
    gpu: { cache: { buffer: cache } },
    layout: { rows: { packedCount: 7, blendFirst: 9, casterSlots: 11 } },
    run: { gpuDrawCalls: 0 },
  } as unknown as WebgpuPagesRuntime;
  const device = {
    createBindGroup: ({ layout }: { layout: string }) => `${layout} group`,
  } as unknown as GPUDevice;
  const encoder = {
    beginRenderPass: (descriptor: { label: string }) => {
      calls.push(['pass', descriptor.label]);
      return {
        setPipeline: (pipeline: string) => calls.push(['pipeline', pipeline]),
        setBindGroup: (slot: number, group: string) => calls.push(['group', slot, group]),
        drawIndirect: (buffer: { name: string }, at: number) =>
          calls.push(['draw', buffer.name, at]),
        end: () => calls.push(['end']),
      };
    },
  } as unknown as GPUCommandEncoder;
  const encode = () => encodeFreshPages(rt, device, encoder);
  return { lights, encode };
}

test('the GPU composes, culls and seals its pages, then draws each layer in two indirect draws', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  encode();
  const composed = ['data', 'state', 'drawList', 'freshFaces', 'freshVolumes', 'freshArgs'];
  assert.deepEqual(calls.slice(0, 4), [
    // The rows the cull tests — the table's, then the blended casters' —, the pairs it may keep.
    ['params', 4, LAYERS, 7, [9, 11], 100],
    ['compose', ...composed, 'freshParams', 1],
    [
      'cull',
      'spheres',
      'freshParams',
      'freshVolumes',
      'vis 5',
      'freshArgs',
      'mobility',
      [(lights.pageRequests.allocation as Record<string, unknown>).freshArgs, 0],
    ],
    ['seal', ...composed, 'freshParams', 1],
  ]);
  for (let layer = 0; layer < LAYERS; layer++) {
    const at = calls.findIndex((call) => call[0] === 'pass' && call[1] === `layer ${layer}`);
    assert.deepEqual(calls.slice(at + 1, at + 9), [
      ['group', 0, 'page group'],
      ['group', 1, 'face group'],
      ['group', 2, 'pool group'],
      ['pipeline', 'clear'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_CLEAR)],
      ['pipeline', 'casters'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_CASTERS)],
      ['end'],
    ]);
  }
  assert.equal(lights.shadowRenderPasses, LAYERS);
});

test("while a tinted layer is read, each layer's GPU pages are drawn into it too", () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  lights.shadows.transmittance = { passes: ['tint 0', 'tint 1'].map((label) => ({ label })) };
  encode();
  for (let layer = 0; layer < LAYERS; layer++) {
    const at = calls.findIndex((call) => call[0] === 'pass' && call[1] === `tint ${layer}`);
    assert.ok(at > 0, `layer ${layer}: its tinted pass`);
    // The pool's opaque depth of that layer, then its pages cleared, then its blended casters.
    assert.deepEqual(calls[at + 3], ['group', 2, 'tint group']);
    const drawn = calls.slice(at, calls.indexOf(calls.slice(at).find((c) => c[0] === 'end')!));
    assert.deepEqual(
      drawn.filter((call) => call[0] === 'pipeline').map((call) => call[1]),
      ['tintClear', 'tintDepth', 'tintColour'],
    );
  }
  assert.equal(lights.shadowRenderPasses, 2 * LAYERS);
});

test('a frame with nothing new to draw encodes none of it; a move, a listed or a lost page does', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  lights.plan.resting = true;
  encode();
  assert.ok(calls.length > 0, 'the first frame the plan is seen runs');
  const runs = (why: string) => {
    calls.length = 0;
    encode();
    assert.ok(
      calls.some((call) => call[0] === 'compose'),
      why,
    );
  };
  calls.length = 0;
  encode();
  assert.deepEqual(calls, [], 'nothing moved, nothing listed, nothing lost: nothing');
  lights.plan.gpu.listed = 3;
  runs('a snapshot listed pages');
  lights.plan.gpu.listed = 0;
  lights.pageRequests.allocation.lost = 1;
  runs('the host took a page');
  lights.pageRequests.allocation.lost = 0;
  lights.store.add({ ...LAMP, id: 'new' });
  runs('a light was added');
  lights.plan.resting = false;
  runs('the view moved');
});

test('nothing is drawn by the GPU while it does not allocate', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  lights.plan.gpu.on = false;
  encode();
  assert.deepEqual(calls, []);
});
