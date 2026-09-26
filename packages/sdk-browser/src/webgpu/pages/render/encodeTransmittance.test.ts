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
import { MAX_SHADOW_REGIONS as R } from '../../../gpu/shadow/atlas.ts';
import { createShadowPageQuads } from '../../../gpu/shadow/pageQuads.ts';
import { SHADOW_TRANSMITTANCE_PASS } from '../../../gpu/shadow/transmittance.ts';
import { createShadowRegionList } from '../../shadow/regions.ts';
import { planPagePasses } from '../../shadow/pagePasses.ts';
import { encodeTransmittance } from './encodeTransmittance.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';

const volumes = new Float32Array(R * SHADOW_CULL_FLOATS),
  volumeWords = new Uint32Array(volumes.buffer);
const { device } = fakeDevice(),
  quads = await createShadowPageQuads(device, device.createBuffer({ size: 4, usage: 0 }));

/** The layer's pass over `pages` pages drawn in `mode`, with or without blended casters: each
 *  render pass's calls, and the draw calls counted. */
function encoded(pages: number, mode: number, casters: boolean) {
  const regions = createShadowRegionList(8);
  for (let page = 0; page < pages; page++) regions.push(page, mode, volumes, volumeWords);
  planPagePasses(regions, regions.count);
  const passes: Array<Array<[string, unknown[]]>> = [];
  const pass = new Proxy({} as Record<string, unknown>, {
    get:
      (_, name: string) =>
      (...args: unknown[]) =>
        void passes.at(-1)!.push([name, args]),
  });
  const encoder = {
    beginRenderPass: (d: GPURenderPassDescriptor) => {
      assert.equal(d.label, SHADOW_TRANSMITTANCE_PASS);
      return (passes.push([]), pass);
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
      shadows: { faceGroup: 'faces', faceStride: 256 },
      regions,
      shadowRenderPasses: 0,
      pageQuads: quads,
    },
  } as unknown as WebgpuPagesRuntime;
  const layer = {
    draws: ['rdepth', 'rblend'],
    passes: [{ label: SHADOW_TRANSMITTANCE_PASS }],
    opaqueGroups: ['opaque'],
  };
  encodeTransmittance(rt, device, encoder as never, layer as never, false);
  const draws = (calls: Array<[string, unknown[]]>) =>
    calls.filter(([name]) => name === 'draw' || name === 'drawIndirect').length;
  assert.equal(rt.lights.shadowRenderPasses, passes.length);
  return { passes, perPass: passes.map(draws), drawCalls: rt.run.gpuDrawCalls, regions };
}

test("a transmittance pass's clears do not change when its regions go from 1 to the maximum", () => {
  for (const [mode, most] of [
    [DRAW_ALL, R],
    [DRAW_DYNAMIC, R],
    // The static layer's regions are not the layer's: only the pool's pass is.
    [DRAW_FULL, R / 2],
  ] as const)
    for (const pages of [1, 2, most / 2, most]) {
      const clears = (casters: boolean) =>
        encoded(pages, mode, casters).passes.map((calls) => calls.filter(([n]) => n === 'draw'));
      for (const casters of [true, false])
        assert.deepEqual(
          clears(casters).map((draws) => draws.length),
          [1],
          `mode ${mode}, ${pages} pages, casters ${casters}: one clear`,
        );
      assert.deepEqual(clears(true)[0][0][1].slice(0, 2), [6, pages], 'every region, once');
      assert.equal(encoded(pages, mode, false).drawCalls, 1, 'no caster: the clear alone');
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
    ['drawIndirect', ['indirect', DRAW_INDIRECT_STRIDE * i]],
    ['setPipeline', ['rblend']],
    ['drawIndirect', ['indirect', DRAW_INDIRECT_STRIDE * i]],
  ];
  const clear = passes[0][1][1][0] as GPURenderPipelineDescriptor;
  assert.equal(clear.label, 'Trillion3D shadow page transmittance clear v1');
  assert.deepEqual(passes[0].slice(2), [
    ['draw', [6, pages, 0, 0]],
    ['setBindGroup', [2, 'opaque']],
    ...region(0),
    ...region(1),
    ...region(2),
    ['end', []],
  ]);
});
