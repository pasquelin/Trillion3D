// OMB-26 (#966): with the raster bins, each region draws its two lists as their classes' commands,
// from the bins' list, a class no row holds left undrawn; the bins run from the cull's lists before
// any draw, then from the occlusion test's. Without the bins, a region draws its two commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAW_ALL } from '../../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { SHADOW_CULL_FLOATS } from '../../../../../sdk-core/src/index.ts';
import { MAX_SHADOW_REGIONS } from '../../../gpu/shadow/atlas.ts';
import { SHADOW_REGION_INDIRECT_BYTES } from '../../../gpu/shadow/batchBudget.ts';
import { SHADOW_BIN_REGION_BYTES } from '../../../gpu/shadow/binShader.ts';
import { createWebgpuLightState } from '../state/lights.ts';
import { VIS_BINDINGS } from '../../core/bindLayout.ts';
import { planPagePasses } from '../../shadow/pagePasses.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { drawRegionCasters, encodeBins } from './encodeRegionDraws.ts';

/** Two regions of the CPU cut, drawn by the pool's three draws; `bins` given or not. */
function frame(bins?: object) {
  const lights = createWebgpuLightState(32),
    volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS);
  for (const page of [0, 1])
    lights.regions.push(page, DRAW_ALL, volumes, new Uint32Array(volumes.buffer));
  const [kept, list, cache, pageTable] = [{ name: 'kept' }, { name: 'bins' }, {}, {}];
  Object.assign(lights, {
    cull: { kept, indirect: 'cull', capacity: 7, drawUniform: {}, offsets: {} },
    occlusion: { visible: 'visible', visibleIndirect: 'visible commands' },
    bins: bins && { ...bins, list, commands: 'bins' },
    mobilityRows: 'mobility',
    shadows: { faceGroup: {}, faceStride: 256, faceUniform: 'faces', hasEnvelope: () => false },
    mobility: { hasCutouts: true, binHolds: (c: number) => c !== 2 },
  });
  const rt = {
    lights,
    gpu: { cache: { buffer: cache } },
    vis: { visBindGroupLayout: {}, concatPos: {}, concatUv: {}, pageTable, zeroFlags: {} },
  } as unknown as WebgpuPagesRuntime;
  Object.assign(rt.vis, { textures: { color: { views: {} } }, mapsSampler: {} });
  planPagePasses(lights.regions, 2);
  const calls: string[] = [],
    instances: unknown[] = [];
  const pass = new Proxy({} as GPURenderPassEncoder, {
    get:
      (_, name: string) =>
      (...args: unknown[]) =>
        void calls.push(`${name} ${args.at(-1)}`),
  });
  const device = {
    createBindGroup: (d: GPUBindGroupDescriptor) => {
      const entry = [...d.entries].find((e) => e.binding === VIS_BINDINGS.instances);
      instances.push(
        Object.is((entry!.resource as GPUBufferBinding).buffer, list) ? 'bins' : 'lists',
      );
      return {};
    },
  } as unknown as GPUDevice;
  const draws = { opaque: 'opaque', envelope: 'envelope', cutout: 'cutout' } as never;
  const drawn = drawRegionCasters(rt, device, pass, 0, false, 1, draws);
  return {
    rt,
    drawn,
    instances,
    draws: calls.filter((c) => /^(setPipeline|drawIndirect)/.test(c)),
  };
}

test('with the bins, each list draws its held classes from the bins’ commands and list', () => {
  const runs: unknown[][] = [];
  const bins = { encode: (...a: unknown[]) => void runs.push([a[1], a[2], a[3], a[4]]) };
  const { rt, drawn, instances, draws } = frame(bins);
  // Classes 0, 1 and 3 hold rows: the opaque list's then the cutout list's, region by region.
  const at = (region: number, bin: number) =>
    `drawIndirect ${region * SHADOW_BIN_REGION_BYTES + 16 * bin}`;
  const region = (r: number) => [
    'setPipeline opaque',
    ...[0, 1, 3].map((c) => at(r, c)),
    'setPipeline cutout',
    ...[4, 5, 7].map((c) => at(r, c)),
  ];
  assert.deepEqual(draws, [...region(0), ...region(1)]);
  assert.equal(drawn, 12);
  assert.deepEqual(instances, ['bins', 'bins'], 'every region reads the bins’ list');
  const encoder = {} as GPUCommandEncoder;
  encodeBins(rt, encoder, 2, false);
  encodeBins(rt, encoder, 2, true);
  const from = (list: unknown, counts: unknown) => ({
    list,
    counts,
    mobility: 'mobility',
    pages: rt.vis.pageTable,
    views: 'faces',
  });
  assert.deepEqual(runs, [
    [0, from(rt.lights.cull!.kept, 'cull'), 2, 7],
    [1, from('visible', 'visible commands'), 2, 7],
  ]);
});

test('without the bins, each region draws its two commands from the lists', () => {
  const { drawn, instances, draws } = frame();
  const at = (region: number, list: number) =>
    `drawIndirect ${region * SHADOW_REGION_INDIRECT_BYTES + 16 * list}`;
  assert.deepEqual(draws, [
    'setPipeline opaque',
    at(0, 0),
    'setPipeline cutout',
    at(0, 1),
    'setPipeline opaque',
    at(1, 0),
    'setPipeline cutout',
    at(1, 1),
  ]);
  assert.equal(drawn, 4);
  assert.deepEqual(instances, ['lists', 'lists']);
});
