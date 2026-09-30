// #1275: the per-pixel demand, run from its shipped WGSL through `shaderRun`: at every lit point
// of a floor under a lamp and a sun, the pages it marks are the pages the shading reads there
// (`shadingReads.fixture.ts`, pinned to the shading's WGSL), the PCF's neighbours included — the
// sun's level or the lamp's mip of the pixel's footprint, over the engine's own frame plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { LAMP, SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import type { ShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import { POINT_FACES } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { SUN_LEVELS } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { dotVector3 } from '../../../../sdk-core/src/math/primitives/vector.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts';
import { shadowViewpointOf } from '../pages/render/encodeShadows.ts';
import { SHADOW_DEMAND_WGSL } from './demandWgsl.ts';
import { HEIGHT, cameraAt, reportScene } from './reportScene.fixture.ts';
import { floorTiles, tileGrid } from './shadingReads.fixture.ts';

type V = number[];
type Demand = {
  demandSun: (index: number, P: V, N: V, footprint: number) => void;
  demandLamp: (index: number, light: object, P: V, N: V, L: V, footprint: number) => void;
};
/** The records the demand reads and the entries it marks: swapped per light, compiled once. */
const live = { records: [] as object[], marked: new Set<number>() };
const demand = shaderRun<Demand>(
  SHADOW_DEMAND_WGSL,
  [
    'demandSun',
    'demandLamp',
    'demandPages',
    'demandPage',
    'shadowPageEntry',
    'sunOrigin',
    'sunReadAt',
    'lampReadAt',
    'shadowNormalTexels',
    'pointFaceOf',
    ...PAGE_MODEL_FUNCTIONS,
  ],
  {
    ...wgslConstants(SHADOW_DEMAND_WGSL),
    shadows: live,
    requestShadowPage: (entry: number) => live.marked.add(entry),
    ShadowAt: (map: object, t: V, home: V, Q: V, texel: number) => ({ map, t, home, Q, texel }),
    LampAt: (at: object, clip: V, ndc: V, face: number, side: number, inside: boolean) => ({
      ...{ at, clip, ndc },
      ...{ face, side, inside },
    }),
    ShadowMap: (base: number, ring: number, pages: number, ox: number, oy: number) => ({
      base,
      ring,
      pages,
      ox,
      oy,
    }),
  },
);

/** The sun's record as the demand reads it: its frame, the window origins of its slots two by
 *  two, and its levels, finest level and first table entry. */
function sunRecord(plan: ShadowPlan, slice: number) {
  const { frame, origins, finest } = plan.sun,
    at = slice * SUN_LEVELS * 2;
  return {
    frame: [0, 1, 2].map((row) => [
      ...frame.subarray(slice * 9 + row * 3, slice * 9 + row * 3 + 3),
    ]),
    origins: Array.from({ length: SUN_LEVELS / 2 }, (_, k) => [
      ...origins.subarray(at + k * 4, at + k * 4 + 4),
    ]),
    info: [SUN_LEVELS, finest[slice], 0, plan.table.baseOf(slice)],
  };
}

/** A point lamp's record: its six face matrices, its faces, tangent half-field and first entry. */
function lampRecord(light: SceneLight, base: number) {
  const matrices = new Float32Array(POINT_FACES * 16);
  let tanHalf = 0;
  for (let face = 0; face < POINT_FACES; face++)
    tanHalf = Math.tan(writeFace(matrices, face * 16, null, 0, light, face).halfFov);
  return {
    faces: Array.from(
      { length: POINT_FACES },
      (_, face) => new Mat([...matrices.subarray(face * 16, face * 16 + 16)]),
    ),
    info: [POINT_FACES, tanHalf, 0, base],
  };
}

test('the demand marks, at each lit point, the pages the shading reads there', () => {
  const lamp: SceneLight = { ...LAMP, position: [0, 3, -12], range: 20 },
    tiles = floorTiles(tileGrid(-4, 4, -16, -8), 9),
    scene = reportScene(71, [lamp, SUN], tiles.boxes),
    cam = cameraAt([0, 3, 0], [0, -0.3, -0.954]);
  const read = scene.frame(1, cam, [], tiles.lits),
    view = shadowViewpointOf(cam, HEIGHT),
    { plan, store } = scene;
  live.marked.clear();
  for (let slot = 0; slot < store.count; slot++) {
    const light = store.light(store.ids[slot])!,
      slice = store.sliceOf(slot);
    const sun = light.kind === 'directional';
    live.records = [sun ? sunRecord(plan, slice) : lampRecord(light, plan.table.baseOf(slice))];
    const before = live.marked.size;
    for (const { P, N } of tiles.lits) {
      // The footprint the shading reads the point at (`shadingReads`).
      const toEye = P.map((x, i) => x - view.position[i]),
        footprint = (view.pixelNear * dotVector3(toEye, view.forward)) / view.near;
      if (sun) demand.demandSun(0, [...P], [...N], footprint);
      else {
        const toLight = light.position!.map((x, i) => x - P[i]),
          radius = Math.hypot(...toLight);
        const positionRange = [...light.position!, light.range!];
        demand.demandLamp(
          0,
          { positionRange, shape: [0, 0, 0, 0] },
          [...P],
          [...N],
          toLight.map((x) => x / radius),
          footprint,
        );
      }
    }
    assert.ok(live.marked.size > before, `${light.kind} marks pages`);
  }
  assert.deepEqual(
    [...live.marked].sort((a, b) => a - b),
    read,
  );
});
