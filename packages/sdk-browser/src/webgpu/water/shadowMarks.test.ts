// #1412: a water surface in the sun, over an unlit opaque floor. The floor's pixels ask for no
// shadow page; the water's marks, run from the shipped marks WGSL through `shaderRun` at the point
// and footprint the composite rebuilds from the depth, ask for the pages its shading reads
// (`shadingReads.fixture.ts`), and the GPU maps and draws them in the frame that asks
// (`gpuFrames.fixture.ts`): the water reads the level it asked for, never a coarser one.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ShadowViewpoint } from '../../../../sdk-core/src/index.ts';
import { invertMatrix4 } from '../../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import { SUN, VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelSignatures.ts';
import { PAGE_MAPPED, PAGE_VALID } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts';
import { SHADOW_READ_STRUCTS, sunRecord } from '../shadow/readStructs.fixture.ts';
import { gpuFrames } from '../shadow/gpuFrames.fixture.ts';
import { floorTiles, shadingReads, tileGrid, type Lit } from '../shadow/shadingReads.fixture.ts';
import { blendShadowMarksWgsl } from '../blend/marksWgsl.ts';

type V = number[];
const [WIDTH, HEIGHT] = [1280, 720];
/** The camera looking down at the water, its axis of unit length. */
const along = [0, -0.3, -0.954].map((c) => c / Math.hypot(0.3, 0.954));
const view: ShadowViewpoint = { ...VIEW, position: [0, 4, 2], forward: along as V as never };
/** The water a metre above the floor, its normal up. */
const water: Lit[] = floorTiles(tileGrid(-2, 2, -10, -8), 3).lits.map(({ P, N }) => ({
  P: [P[0], 1, P[2]],
  N,
}));

/** The view's projection, column-major, depth from 0 at the near plane to 1 at the far one. */
function viewProjection() {
  const f = view.forward,
    eye = view.position,
    right = [-f[2], 0, f[0]].map((c) => c / Math.hypot(f[0], f[2])),
    up = [0, 1, 2].map(
      (i) => right[(i + 1) % 3] * f[(i + 2) % 3] - right[(i + 2) % 3] * f[(i + 1) % 3],
    );
  const rows = [right, up, f.map((c) => -c)],
    t = Math.tan(view.halfFovY),
    { near, far } = view;
  const scale = [1 / (t * view.aspect), 1 / t, far / (near - far)],
    out = new Float64Array(16);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) out[col * 4 + row] = scale[row] * rows[row][col];
  for (let row = 0; row < 3; row++)
    out[12 + row] = -scale[row] * rows[row].reduce((s, c, i) => s + c * eye[i], 0);
  out[14] += (near * far) / (near - far);
  for (let col = 0; col < 3; col++) out[col * 4 + 3] = -rows[2][col];
  out[15] = rows[2].reduce((s, c, i) => s + c * eye[i], 0);
  return out;
}
const projection = viewProjection();

/** Pixel and depth of world point `P` through the view. */
function pixelOf(P: V) {
  const clip = [0, 1, 2, 3].map(
    (row) =>
      projection[row] * P[0] +
      projection[4 + row] * P[1] +
      projection[8 + row] * P[2] +
      projection[12 + row],
  );
  const [x, y, z] = clip.map((c) => c / clip[3]);
  return { pixel: [((x + 1) / 2) * WIDTH, ((1 - y) / 2) * HEIGHT], z };
}

const MARKS_WGSL = blendShadowMarksWgsl();
const K = wgslConstants(MARKS_WGSL);
const live = { records: [] as object[], marked: new Set<number>() };
const sun = { params: [0, 0, 0, 0] };
const marks = shaderRun<{ markWaterAt: (pixel: V, z: number, N: V) => void }>(
  MARKS_WGSL,
  [
    ...['markWaterAt', 'worldAt', 'waterShadowFootprint', 'waterViewDirection', 'waterFacing'],
    ...['markBlendShadows', 'demandSlice', 'demandLight', 'demandSun', 'demandPages'],
    ...['demandPage', 'shadowPageEntry', 'sunOrigin', 'sunReadAt', 'shadowNormalTexels'],
    ...PAGE_MODEL_FUNCTIONS,
  ],
  {
    ...K,
    // The deferred view the composite rebuilds its point through.
    view: {
      viewport: [WIDTH, HEIGHT, 0, 0],
      inverseViewProjection: new Mat([...invertMatrix4(new Float64Array(16), projection)]),
      camera: [...view.position, 1],
    },
    shadows: live,
    shadowUnjitter: [0, 0, 0],
    requestShadowPage: (entry: number) => live.marked.add(entry),
    uni: { lightTiles: [0, 0] },
    gridCell: () => K.TILE_NO_SLICE,
    directLights: { count: 1, items: [sun] },
    tileLights: [],
    isRect: () => false,
    isSun: () => true,
    directIncidence: () => [0, 1, 0, 1],
    ...SHADOW_READ_STRUCTS,
  },
);

test('a water surface in the sun has its own shadow pages asked for and drawn', async () => {
  const run = gpuFrames(16, [SUN]),
    { plan, store, table } = run;
  // The floor is unlit: the opaque pixels ask for nothing, the water's pages wait on its marks.
  await run.frame(1, view, [], () => {});
  const read = shadingReads(plan, store, view, water);
  assert.ok(read.length > 0, 'the water reads sun pages');
  assert.ok(
    read.some((entry) => !(table[entry] & PAGE_VALID)),
    'witness: without the marks, some page the water reads is not drawn',
  );
  live.records = [sunRecord(plan, store.sliceOf(0))];
  live.marked.clear();
  for (const { P, N } of water) {
    const { pixel, z } = pixelOf(P as V);
    marks.markWaterAt(pixel, z, N as V);
  }
  // What the marks ask for is what the water reads, at the level it wants.
  assert.deepEqual(
    [...live.marked].sort((a, b) => a - b),
    read,
  );
  await run.frame(2, view, [], () => {}, [...live.marked]);
  for (const entry of read) {
    assert.ok(table[entry] & PAGE_MAPPED, `${entry} mapped in the frame that asks`);
    assert.ok(table[entry] & PAGE_VALID, `${entry} drawn: read at its own level`);
  }
});
