// #1345: the moving casters of a pass's restored sun pages are drawn by group, one instanced draw
// per group and list instead of one per page. The shipped pairs kernel files every kept caster of
// every grouped page once in its group's draw, and the shipped vertex stage draws each by its own
// page's view; a lamp page, and a page alone in its block, keep their own draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DRAW_DYNAMIC } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  LAMP,
  SUN,
  VIEW,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { GROUP_CAPACITY_WORD } from '../../gpu/shadow/batchBudget.ts';
import { SHADOW_GROUP_PAIRS_WGSL } from '../../gpu/shadow/groupWgsl.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { drawRegionCasters } from '../pages/render/encodeRegionDraws.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { createMovingGroupPlan } from './movingGroupPlan.ts';
import { createShadowMovingGroups } from './movingGroups.ts';
import { planPagePasses } from './pagePasses.ts';

/** A pool of 51² pages, 6 528 texels a side: its blocks are 4 096 texels, at its start or end. */
const SIDE = 51,
  CAPACITY = 10;
/** Two sun pages in the first block, two in the right one, one alone in the bottom one, a lamp's. */
const PAGES = [0, 1, 40, 41, 40 * SIDE, 5];
/** Each region's kept casters, opaque then cutout, and the corners each list draws. */
const KEPT = [
  [3, 1, 30, 12],
  [2, 0, 45, 0],
  [1, 2, 9, 20],
  [0, 0, 0, 0],
];

function batch() {
  const lights = createWebgpuLightState(SIDE);
  lights.store.add(SUN);
  lights.store.add(LAMP);
  lights.plan.plan(lights.store, VIEW, [-10, 0, -10], [10, 5, 10], 0, 0);
  const volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS);
  for (const [i, page] of PAGES.entries()) {
    lights.plan.pool.slice[page] = lights.store.sliceOf(i === 5 ? 1 : 0);
    lights.regions.push(page, DRAW_DYNAMIC, volumes, new Uint32Array(volumes.buffer));
  }
  planPagePasses(lights.regions, PAGES.length);
  return { lights, rt: { lights } as unknown as WebgpuPagesRuntime };
}

test("a pass's restored sun pages are grouped by block; a lamp page and a lone one are not", () => {
  const { rt } = batch(),
    grouping = createMovingGroupPlan();
  assert.equal(grouping.plan(rt, PAGES.length, false, CAPACITY), 2);
  assert.deepEqual([...grouping.grouped.subarray(0, 6)], [1, 1, 1, 1, 0, 0]);
  assert.deepEqual([...grouping.words.subarray(0, 6)], [1, 1, 2, 2, 0, 0]);
  const head = MAX_SHADOW_REGIONS;
  assert.deepEqual([...grouping.words.subarray(head, head + 6)], [0, 20, 0, 20, 40, 1]);
  assert.equal(grouping.words[GROUP_CAPACITY_WORD], CAPACITY);
});

test('every kept caster of a grouped page is drawn once, in its group, by its own view', () => {
  const { rt } = batch(),
    grouping = createMovingGroupPlan();
  grouping.plan(rt, PAGES.length, false, CAPACITY);
  const culled = new Uint32Array(MAX_SHADOW_REGIONS * 8);
  for (const [region, [opaque, cutout, corners, cutCorners]] of KEPT.entries())
    culled.set([corners, opaque, 0, 0, cutCorners, cutout, 0, 0], region * 8);
  const args = new Array<number>(16).fill(0),
    pairs = new Array<number>(40).fill(-1);
  // One lane does the whole workgroup's copies: the kernel's stride of 64 lanes, one.
  const kernel = shaderRun<{ shadowGroupPairs: (wg: number[], lane: number) => void }>(
    SHADOW_GROUP_PAIRS_WGSL.replace('i+=64u', 'i+=1u'),
    ['shadowGroupPairs', 'keptCount', 'keptCorners', 'keptAt'],
    {
      ...{ table: grouping.words, culled, visible: culled, args, pairs, claimed: 0 },
      workgroupUniformLoad: (p: { get: () => number }) => p.get(),
      workgroupBarrier: () => {},
    },
  );
  for (let region = 0; region < PAGES.length; region++) kernel.shadowGroupPairs([region, 0, 0], 0);
  assert.deepEqual(args, [45, 5, 0, 0, 12, 1, 0, 0, 9, 1, 65536, 0, 20, 2, 65536, 0]);
  const texels = SIDE * SHADOW_PAGE,
    views = PAGES.map((page) => {
      const [x, y] = [(page % SIDE) * SHADOW_PAGE, Math.floor(page / SIDE) * SHADOW_PAGE];
      return { view: { params: [x / texels, y / texels, SHADOW_PAGE / texels, SHADOW_PAGE] } };
    });
  const drawn: string[] = [];
  const { groupCaster } = shaderRun<{
    groupCaster: (vertex: number, instance: number, cutout: boolean) => Record<string, number>;
  }>(SHADOW_DEPTH_SHADER, ['groupCaster', 'groupBlock', 'groupPlace', 'pageFirst'], {
    ...{ groupTable: grouping.words, groupPairs: pairs, groupViews: views },
    groupInstances: Array.from({ length: 60 }, (_, place) => 1000 + place),
    firstLeadingBit: (x: number) => 31 - Math.clz32(x),
    shadowVertexIn: (view: object, corner: number, row: number, blended: boolean) => {
      drawn.push(`${views.findIndex((v) => v.view === view)}:${row}:${corner}:${blended}`);
      return { position: [0.25, -0.5, 0.5, 1], instance: row };
    },
  });
  for (let group = 0; group < 2; group++)
    for (const cutout of [false, true])
      for (let i = 0; i < args[group * 8 + (cutout ? 5 : 1)]; i++) {
        const out = groupCaster((group << 16) + 7, i, cutout);
        assert.equal(Math.trunc(out.region), Number(drawn.at(-1)!.split(':')[0]));
      }
  // Region `r`'s rank `k` sits at `r · 10 + k`, a cutout's at `r · 10 + 9 − k`.
  const rows = (region: number, ranks: number[]) =>
    ranks.map((k) => `${region}:${1000 + k}:7:false`);
  assert.deepEqual(
    drawn.sort(),
    [...rows(0, [0, 1, 2, 9]), ...rows(1, [10, 11]), ...rows(2, [20, 29, 28])].sort(),
  );
});

test('a grouped page is skipped by its own draws and drawn by its group, in its block', async () => {
  const { lights, rt } = batch(),
    { device } = fakeDevice();
  const groups = await createShadowMovingGroups(device),
    key = [{}, {}, {}, {}, {}, {}];
  Object.assign(lights, {
    cull: { kept: { size: MAX_SHADOW_REGIONS * CAPACITY * 4 }, indirect: {}, drawUniform: {} },
    shadows: {
      faceGroup: 'faces',
      faceUniform: {},
      hasEnvelope: () => false,
      freshDraws: { pageLayout: {} },
      groupDraws: { layout: {}, made: () => ({ opaque: 'opaque', cutout: 'cutout' }) },
    },
    mobility: { hasCutouts: true },
    shadowGroupsKey: key,
    shadowGroups: Array.from({ length: 2 * MAX_SHADOW_REGIONS }, (_, i) => `g${i}`),
  });
  Object.assign(rt, {
    gpu: { cache: { buffer: key[0] } },
    vis: { visBindGroupLayout: {}, concatPos: key[1], concatUv: key[2], pageTable: key[3] },
  });
  Object.assign(rt.vis, { textures: { color: { views: key[4] } }, mapsSampler: {}, zeroFlags: {} });
  const dispatched: number[] = [];
  const encoder = {
    clearBuffer() {},
    beginComputePass: () => ({
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups: (n: number) => void dispatched.push(n),
      end() {},
    }),
  } as unknown as GPUCommandEncoder;
  assert.equal(groups.encode(rt, encoder, PAGES.length, false), 2);
  assert.deepEqual(dispatched, [PAGES.length], 'one workgroup a region');
  const calls: string[] = [];
  const pass = new Proxy({} as GPURenderPassEncoder, {
    get:
      (_, name: string) =>
      (...args: unknown[]) =>
        void calls.push(`${name} ${args.map((a) => (typeof a === 'object' ? '·' : a))}`),
  });
  const alone = drawRegionCasters(
    rt,
    device,
    pass,
    0,
    false,
    1,
    ['depth' as never],
    groups.grouped,
  );
  assert.equal(alone, 2, 'the lone sun page and the lamp page');
  calls.length = 0;
  assert.equal(groups.draw(rt, pass, 0), 4, 'two groups, their opaque and cutout lists');
  const far = SIDE * SHADOW_PAGE - 4096;
  assert.deepEqual(
    calls.filter((c) => /^(setViewport|drawIndirect|setPipeline)/.test(c)),
    [
      'setViewport 0,0,4096,4096,0,1',
      'setPipeline opaque',
      'drawIndirect ·,0',
      'setPipeline cutout',
      'drawIndirect ·,16',
      `setViewport ${far},0,4096,4096,0,1`,
      'setPipeline opaque',
      'drawIndirect ·,32',
      'setPipeline cutout',
      'drawIndirect ·,48',
    ],
  );
});
