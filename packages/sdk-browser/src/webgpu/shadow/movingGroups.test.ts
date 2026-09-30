// #1345: the moving casters of a pass's restored pages are drawn by group, one instanced draw per
// group and list instead of one per page. The shipped pairs kernel files every kept caster of every
// grouped page once in its group's draw, and the shipped vertex stage draws each by its own page's
// view; a lamp's pages and a page alone in its block are groups too: no restored page keeps a draw
// of its own, as Unreal draws every page of a light in batched draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { GROUP_CAPACITY_WORD } from '../../gpu/shadow/batchBudget.ts';
import { GROUP_LAYER, SHADOW_GROUP_PAIRS_WGSL } from '../../gpu/shadow/groupWgsl.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { drawRegionCasters } from '../pages/render/encodeRegionDraws.ts';
import { createMovingGroupPlan } from './movingGroupPlan.ts';
import { createShadowMovingGroups } from './movingGroups.ts';
import { batch, CAPACITY, KEPT, PAGES, SIDE } from './movingGroups.fixture.ts';

test("a pass's restored pages are grouped: sun pages by block, alone or not, a lamp's by layer", () => {
  const { rt } = batch(),
    grouping = createMovingGroupPlan();
  assert.equal(grouping.plan(rt, PAGES.length, false, CAPACITY), 4);
  assert.deepEqual([...grouping.words.subarray(0, 6)], [1, 1, 2, 2, 3, 4], 'every page grouped');
  const head = MAX_SHADOW_REGIONS;
  assert.deepEqual(
    [...grouping.words.subarray(head, head + 12)],
    [0, 20, 0, 20, 40, 1, 40, 50, 2, 50, 60, GROUP_LAYER],
  );
  assert.equal(grouping.words[GROUP_CAPACITY_WORD], CAPACITY);
  // A device that cannot clip a caster to its page keeps the lamp page's own viewport.
  assert.equal(grouping.plan(batch(false).rt, PAGES.length, false, CAPACITY), 3);
  assert.deepEqual([...grouping.words.subarray(0, 6)], [1, 1, 2, 2, 3, 0]);
});

test('every kept caster of a grouped page is drawn once, in its group, by its own view', () => {
  const { rt } = batch(),
    grouping = createMovingGroupPlan();
  grouping.plan(rt, PAGES.length, false, CAPACITY);
  const culled = new Uint32Array(MAX_SHADOW_REGIONS * 8);
  for (const [region, [opaque, cutout, corners, cutCorners]] of KEPT.entries())
    culled.set([corners, opaque, 0, 0, cutCorners, cutout, 0, 0], region * 8);
  const args = new Array<number>(32).fill(0),
    pairs = new Array<number>(60).fill(-1);
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
  // The lone page's and the lamp's groups keep none: their pages have no kept caster here.
  const none = (g: number) => [0, 0, g << 16, 0, 0, 0, g << 16, 0];
  assert.deepEqual(args, [
    ...[45, 5, 0, 0, 12, 1, 0, 0, 9, 1, 65536, 0, 20, 2, 65536, 0],
    ...none(2),
    ...none(3),
  ]);
  const texels = SIDE * SHADOW_PAGE,
    views = PAGES.map((page) => {
      const [x, y] = [(page % SIDE) * SHADOW_PAGE, Math.floor(page / SIDE) * SHADOW_PAGE];
      return { view: { params: [x / texels, y / texels, SHADOW_PAGE / texels, SHADOW_PAGE] } };
    });
  const drawn: string[] = [];
  const { groupCaster } = shaderRun<{
    groupCaster: (v: number, i: number, cutout: boolean, blend: boolean) => Record<string, number>;
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
        const out = groupCaster((group << 16) + 7, i, cutout, false);
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

test('a grouped page is skipped by its own draws and drawn by its group, in the pool and at half', async () => {
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
      targets: [{}],
      groupDraws: {
        ...{ layout: {}, blendLayout: {}, lamps: true },
        blended: (lamp: boolean) => (lamp ? ['lamp depth', 'lamp colour'] : ['depth', 'colour']),
        made: (lamp: boolean) => ({
          opaque: `${lamp ? 'lamp ' : ''}opaque`,
          cutout: `${lamp ? 'lamp ' : ''}cutout`,
        }),
      },
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
  assert.equal(groups.encode(rt, encoder, PAGES.length, false), 4);
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
  assert.equal(alone, 0, 'no page keeps a draw of its own');
  calls.length = 0;
  assert.equal(groups.draw(rt, pass, 0), 8, 'four groups, their opaque and cutout lists');
  const texels = SIDE * SHADOW_PAGE,
    far = texels - 4096;
  const viewports = (scale: number) =>
    [
      [0, 0, 4096],
      [far, 0, 4096],
      [0, far, 4096],
      [0, 0, texels],
    ].map((v) => `setViewport ${v.map((n) => n / scale)},${v[2] / scale},0,1`);
  const drawn = () => calls.filter((c) => /^(setViewport|drawIndirect|setPipeline)/.test(c));
  assert.deepEqual(
    drawn(),
    viewports(1).flatMap((viewport, g) => [
      viewport,
      `setPipeline ${g === 3 ? 'lamp ' : ''}opaque`,
      `drawIndirect ·,${32 * g}`,
      `setPipeline ${g === 3 ? 'lamp ' : ''}cutout`,
      `drawIndirect ·,${32 * g + 16}`,
    ]),
  );
  // The transmittance layer's pass: each group's blended casters, depth then colour, at half.
  calls.length = 0;
  assert.equal(groups.drawBlend(rt, pass, 0, 0), 8);
  assert.deepEqual(
    drawn(),
    viewports(2).flatMap((viewport, g) => [
      viewport,
      `setPipeline ${g === 3 ? 'lamp ' : ''}depth`,
      `drawIndirect ·,${32 * g}`,
      `setPipeline ${g === 3 ? 'lamp ' : ''}colour`,
      `drawIndirect ·,${32 * g}`,
    ]),
  );
});
