// #867: the transmittance layer's pass clears its pages in one instanced draw, whatever its
// regions, then draws each region's blended casters in its page's viewport, at half its place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../../sdk-core/src/index.ts';
import {
  DRAW_ALL,
  DRAW_DYNAMIC,
  DRAW_FULL,
} from '../../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { SHADOW_PAGE } from '../../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { DRAW_INDIRECT_STRIDE } from '../../../gpu/draw/draw.ts';
import { SHADOW_REGION_INDIRECT_BYTES as REGION_BYTES } from '../../../gpu/shadow/batchBudget.ts';
import { MAX_SHADOW_REGIONS as R } from '../../../gpu/shadow/atlas.ts';
import { createShadowPageQuads } from '../../../gpu/shadow/pageQuads.ts';
import {
  SHADOW_TRANSLUCENT_DEPTH_FORMAT,
  SHADOW_TRANSMITTANCE_FORMAT,
  SHADOW_TRANSMITTANCE_PASS,
} from '../../../gpu/shadow/transmittance.ts';
import { createShadowRegionList } from '../../shadow/regions.ts';
import { planPagePasses } from '../../shadow/pagePasses.ts';
import { encodeTransmittance } from './encodeTransmittance.ts';
import { drawRegionCasters } from './encodeRegionDraws.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';

const volumes = new Float32Array(R * SHADOW_CULL_FLOATS),
  volumeWords = new Uint32Array(volumes.buffer);
const { device } = fakeDevice(),
  quads = await createShadowPageQuads(device, device.createBuffer({ size: 4, usage: 0 }));

type Calls = Array<[string, unknown[]]>;
/** A render pass that records every call it receives into `calls`, by name, in order. */
const recorder = (calls: Calls) =>
  new Proxy({} as GPURenderPassEncoder, {
    get:
      (_, name: string) =>
      (...args: unknown[]) =>
        void calls.push([name, args]),
  });

/** The layer's pass over `pages` pages drawn in `mode`, with or without blended casters: each
 *  render pass's calls, and the draw calls counted. */
function encoded(pages: number, mode: number, casters: boolean) {
  const regions = createShadowRegionList(8);
  for (let page = 0; page < pages; page++) regions.push(page, mode, volumes, volumeWords);
  planPagePasses(regions, regions.count);
  const passes: Calls[] = [];
  const encoder = {
    beginRenderPass: (d: GPURenderPassDescriptor) => {
      assert.equal(d.label, SHADOW_TRANSMITTANCE_PASS);
      return recorder((passes[passes.length] = []));
    },
  };
  const kept = {},
    key = [{}, {}, {}, {}, {}, kept, undefined];
  const rt = {
    vis: {
      visBindGroupLayout: {},
      concatPos: key[1],
      concatUv: key[2],
      pageTable: key[3],
      textures: { color: { views: key[4] } },
      mapsSampler: {},
      zeroFlags: {},
    },
    gpu: { cache: { buffer: key[0] } },
    run: { gpuDrawCalls: 0 },
    services: { blendCasters: { used: casters ? 1 : 0 } },
    lights: {
      cull: { kept, indirect: 'indirect' },
      shadowGroupsKey: key,
      shadowGroups: Array.from({ length: 2 * R }, (_, i) => `g${i}`),
      // Region 1's face alone carries an emitter envelope.
      shadows: { faceGroup: 'faces', faceStride: 256, hasEnvelope: (r: number) => r === 1 },
      regions,
      shadowRenderPasses: 0,
    },
  } as unknown as WebgpuPagesRuntime;
  const layer = {
    draws: ['rdepth', 'rblend'],
    passes: [{ label: SHADOW_TRANSMITTANCE_PASS }],
    opaqueGroups: ['opaque'],
  };
  encodeTransmittance(rt, device, encoder as never, quads, layer as never, false);
  const draws = (calls: Calls) =>
    calls.filter(([name]) => name === 'draw' || name === 'drawIndirect').length;
  assert.equal(rt.lights.shadowRenderPasses, passes.length);
  return { passes, perPass: passes.map(draws), drawCalls: rt.run.gpuDrawCalls, regions, rt };
}

test("a transmittance pass's clears do not change when its regions go from 1 to the maximum", () => {
  for (const [mode, most] of [
    [DRAW_ALL, R],
    [DRAW_DYNAMIC, R],
    // The static layer's regions are not the layer's: only the pool's pass is.
    [DRAW_FULL, R / 2],
  ] as const)
    for (const pages of [1, 2, most / 2, most])
      for (const casters of [true, false]) {
        const { passes, drawCalls } = encoded(pages, mode, casters);
        const clears = passes.map((calls) => calls.filter(([n]) => n === 'draw'));
        const where = `mode ${mode}, ${pages} pages, casters ${casters}`;
        assert.deepEqual(
          clears.map((draws) => draws.length),
          [1],
          `${where}: one clear`,
        );
        assert.deepEqual(clears[0][0][1].slice(0, 2), [6, pages], 'every region, once');
        if (!casters) assert.equal(drawCalls, 1, 'no caster: the clear alone');
      }
});

test('each region draws its list twice at half its page place, after the clear', () => {
  const pages = 3,
    { passes, perPass, drawCalls, regions } = encoded(pages, DRAW_ALL, true);
  assert.deepEqual(perPass, [1 + 2 * pages]);
  assert.equal(drawCalls, 1 + 2 * pages);
  const half = SHADOW_PAGE / 2;
  const region = (i: number) => [
    ['setViewport', [regions.x(i) / 2, regions.y(i) / 2, half, half, 0, 1]],
    ['setScissorRect', [regions.x(i) / 2, regions.y(i) / 2, half, half]],
    ['setBindGroup', [0, `g${i}`]],
    ['setBindGroup', [1, 'faces', [256 * i]]],
    ['setPipeline', ['rdepth']],
    ['drawIndirect', ['indirect', REGION_BYTES * i]],
    ['setPipeline', ['rblend']],
    ['drawIndirect', ['indirect', REGION_BYTES * i]],
  ];
  const [, [clear]] = passes[0].find(([name]) => name === 'setPipeline')! as [
    string,
    [GPURenderPipelineDescriptor],
  ];
  assert.equal(clear.label, 'Trillion3D shadow page transmittance clear v1');
  // The layer's own formats, and far written whatever was there.
  assert.deepEqual(
    [...clear.fragment!.targets].map((t) => t!.format),
    [SHADOW_TRANSMITTANCE_FORMAT],
  );
  assert.deepEqual(clear.depthStencil, {
    format: SHADOW_TRANSLUCENT_DEPTH_FORMAT,
    depthWriteEnabled: true,
    depthCompare: 'always',
  });
  assert.deepEqual(passes[0].slice(2), [
    ['draw', [6, pages, 0, 0]],
    ['setBindGroup', [2, 'opaque']],
    ...region(0),
    ...region(1),
    ...region(2),
    ['end', []],
  ]);
});

// #965: a region's opaque list is drawn with no fragment stage — with the fragment that strips the
// envelope on a face that has one —, its cutout list with the fragment test, from its second command.
test("the pool's depth pass draws each region's opaque then cutout list, by their own pipelines", () => {
  const { rt } = encoded(3, DRAW_ALL, false),
    calls: Calls = [];
  const depth = { opaque: 'opaque', envelope: 'envelope', cutout: 'cutout' } as never;
  assert.equal(drawRegionCasters(rt, device, recorder(calls), 0, false, 1, depth), 6);
  const draws = calls.filter(([name]) => name === 'setPipeline' || name === 'drawIndirect');
  const lists = (pipeline: string, i: number) => [
    ['setPipeline', [pipeline]],
    ['drawIndirect', ['indirect', REGION_BYTES * i]],
    ['setPipeline', ['cutout']],
    ['drawIndirect', ['indirect', REGION_BYTES * i + DRAW_INDIRECT_STRIDE]],
  ];
  assert.deepEqual(draws, [...lists('opaque', 0), ...lists('envelope', 1), ...lists('opaque', 2)]);
});

test('a pipeline is set only when it changes, whatever the regions', () => {
  for (const pages of [1, R]) {
    const { rt } = encoded(pages, DRAW_ALL, false),
      calls: Calls = [];
    const draws = drawRegionCasters(rt, device, recorder(calls), 0, false, 1, ['depth' as never]);
    assert.equal(draws, pages);
    assert.equal(calls.filter(([name]) => name === 'setPipeline').length, 1, `${pages} pages`);
  }
});
