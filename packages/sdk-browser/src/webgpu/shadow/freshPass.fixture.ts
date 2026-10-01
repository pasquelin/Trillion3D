// The runtime of a frame that draws the GPU's own pages (`freshPass.ts`), every resource a named
// stand-in recording what it encodes: the fixture of `freshPass.test.ts` and
// `freshStaticLayer.test.ts`.
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FRESH_LAYER_PASS } from '../../stage/passLabels.ts';
import { encodeFreshPages } from './freshPass.ts';

export const LAYERS = 2;

/** A frame's runtime with a pool of two layers, every resource a named stand-in, and what it
 *  encodes into `calls`. */
export function frame(calls: unknown[][]) {
  const named = (name: string) => ({ name, size: 800 }) as unknown as GPUBuffer & { name: string };
  const [cache, position, uv, pageTable, views, kept] = [0, 1, 2, 3, 4, 5].map((k) =>
    named(`vis ${k}`),
  );
  const pass = (name: string) => (_: unknown, bound: { name: string }[], groups: unknown) =>
    calls.push([name, ...bound.map((buffer) => buffer.name), groups]);
  const buffers = ['state', 'drawList', 'freshFaces', 'freshVolumes', 'freshArgs', 'freshParams'];
  buffers.push('freshDispatch');
  /** The static fill the frame handed the GPU's draws (`writeFresh`). */
  const written = { budget: -1 };
  const lights = {
    store: createSceneLightStore(),
    plan: {
      // The first frame whose page draws ran since a snapshot counted them (`mirror.ts`).
      gpu: {
        on: true,
        listed: 0,
        moved: true,
        drewAt: Infinity,
        layered: false,
        drew(frame: number, layered = false) {
          this.drewAt = Math.min(this.drewAt, frame);
          this.layered = layered;
        },
      },
      pool: { side: 4, layers: LAYERS, pages: 4 * 4 * LAYERS },
    },
    allocation: Object.fromEntries(
      ['compose', 'count', 'admit', 'cull', 'seal'].map((name) => [name, pass(name)]),
    ),
    pageRequests: {
      allocation: {
        seeded: true,
        lost: 0,
        pagesPerFrame: 24,
        ...Object.fromEntries(buffers.map((k) => [k, named(k)])),
        writeFresh: (...args: unknown[]) => {
          written.budget = args[6] as number;
          calls.push(['params', ...args.slice(0, 5)]);
        },
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
            [
              'clear',
              'casters',
              'staticCasters',
              'restore',
              'movingCasters',
              'tintClear',
              'tintDepth',
              'tintColour',
            ].map((k) => [k, k]),
          ),
      },
      faceGroup: 'face group',
    },
    cull: { kept, capacity: 11, drawUniform: named('draw slots'), offsets: named('offsets') },
    spheres: { buffer: named('spheres') },
    mobilityRows: named('mobility'),
    rowLods: { buffer: named('row lods') },
    staticLayer: undefined as unknown,
    shadowWork: { rasterizedPages: 0 },
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
    run: { gpuDrawCalls: 0, frame: 7 },
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
  return { lights, encode, written };
}

/** The pool's static layer, a group per pool layer: the bind groups it hands the fresh draws. */
export const STATIC_GROUPS = Array.from({ length: LAYERS }, (_, layer) => `static group ${layer}`);

/** Gives `lights` a static layer of `LAYERS` layers, each fresh pass labelled as the engine's. */
export function withStaticLayer(lights: ReturnType<typeof frame>['lights']) {
  const freshPasses = STATIC_GROUPS.map(() => ({ label: FRESH_LAYER_PASS }));
  lights.staticLayer = {
    passes: STATIC_GROUPS.map(() => ({})),
    freshPasses,
    groups: STATIC_GROUPS,
  };
}

/** The labels of the render passes `calls` recorded, in order. */
export const passLabels = (calls: unknown[][]) =>
  calls.filter((call) => call[0] === 'pass').map((call) => call[1]);
