// #1411: a transparent pane over an unlit opaque floor. The floor's pixels ask for no shadow page;
// the pane's marks, run from the shipped marks WGSL through `shaderRun`, ask for the pages its
// shading reads (`shadingReads.fixture.ts`), and the GPU maps and draws them in the frame that asks
// (`gpuFrames.fixture.ts`): the pane reads the level it asked for, never a coarser one. #1412: so
// does a water surface there, marked at the point and footprint the composite rebuilds from the
// depth.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ShadowViewpoint } from '../../../../sdk-core/src/index.ts';
import {
  basisMatrix4,
  createCameraFrame,
  crossVector3,
  invertMatrix4,
  perspectiveProjection,
  transformHomogeneousPoint,
  updateCameraFrame,
} from '../../../../sdk-core/src/math/index.ts';
import { SUN, VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelSignatures.ts';
import { PAGE_MAPPED, PAGE_VALID } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { functionsOf, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts';
import { SHADOW_READ_STRUCTS, sunRecord } from '../shadow/readStructs.fixture.ts';
import { gpuFrames } from '../shadow/gpuFrames.fixture.ts';
import {
  floorTiles,
  footprintAt,
  shadingReads,
  tileGrid,
  type Lit,
} from '../shadow/shadingReads.fixture.ts';
import { blendShadowMarksWgsl } from './marksWgsl.ts';
import { blendShader } from './shader.ts';
import { waterCompositeShader } from '../water/compositeWgsl.ts';

type V = number[];
const [WIDTH, HEIGHT] = [1280, 720];
/** The camera looking down the floor, its axis of unit length, and the pane a metre above the
 *  floor, its normal up: the water's surface too. */
const along = [0, -0.3, -0.954].map((c) => c / Math.hypot(0.3, 0.954));
const view: ShadowViewpoint = { ...VIEW, position: [0, 4, 2], forward: along as never };
const pane: Lit[] = floorTiles(tileGrid(-2, 2, -10, -8), 3).lits.map(({ P, N }) => ({
  P: [P[0], 1, P[2]],
  N,
}));

/** The view's projection (`perspectiveProjection`: reversed depth, infinite far plane). */
function viewProjection() {
  const right = crossVector3([0, 0, 0], along, [0, 1, 0]).map(
      (c) => c / Math.hypot(along[0], along[2]),
    ),
    up = crossVector3([0, 0, 0], right, along),
    world = basisMatrix4(
      new Float64Array(16),
      right,
      up,
      along.map((c) => -c),
      view.position,
    ),
    projection = new Float64Array(16);
  perspectiveProjection(projection, (view.halfFovY * 360) / Math.PI, view.aspect, view.near, 1);
  return updateCameraFrame(createCameraFrame(), projection, world).viewProjection;
}
const projection = viewProjection();

/** Pixel and depth of world point `P` through the view. */
function pixelOf(P: V) {
  const [x, y, z, w] = transformHomogeneousPoint([0, 0, 0, 0], projection, P[0], P[1], P[2]);
  return { pixel: [((x / w + 1) / 2) * WIDTH, ((1 - y / w) / 2) * HEIGHT], z: z / w };
}

const MARKS_WGSL = blendShadowMarksWgsl();
const K = wgslConstants(MARKS_WGSL);
/** The records the marks read and the entries they ask for. */
const live = { records: [] as object[], marked: new Set<number>() };
/** The sun, the scene's one light, in shadow slice 0: no light grid, every light is walked. */
const sun = { params: [0, 0, 0, 0] };
const marks = shaderRun<{
  markBlendShadows: (
    pixel: V,
    z: number,
    P: V,
    N: V,
    thin: boolean,
    bothSides: boolean,
    footprint: number,
  ) => void;
  markWaterAt: (pixel: V, z: number, N: V) => void;
}>(
  MARKS_WGSL,
  [
    ...['markWaterAt', 'worldAt', 'waterShadowFootprint', 'waterViewDirection', 'waterFacing'],
    ...['markBlendShadows', 'demandSlice', 'demandLight', 'demandSun', 'demandPages'],
    ...['demandPage', 'shadowPageEntry', 'sunOrigin', 'sunReadAt', 'shadowNormalTexels'],
    ...PAGE_MODEL_FUNCTIONS,
  ],
  {
    ...K,
    // The deferred view the water composite rebuilds its point through.
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
    // The sun lights the pane from straight above.
    directIncidence: () => [0, 1, 0, 1],
    ...SHADOW_READ_STRUCTS,
  },
);

/** Runs `mark` on every point of the pane on a fresh frame pair: the pages the pane's shading reads
 *  are not all drawn before (witness), the marks ask for exactly them, and the next frame maps and
 *  draws every one. */
async function marksItsOwnPages(mark: (lit: Lit) => void) {
  const run = gpuFrames(16, [SUN]),
    { plan, store, table } = run;
  // The floor is unlit: the opaque pixels ask for nothing, the pane's pages wait on their marks.
  await run.frame(1, view, [], () => {});
  const read = shadingReads(plan, store, view, pane);
  assert.ok(read.length > 0, 'the pane reads sun pages');
  assert.ok(
    read.some((entry) => !(table[entry] & PAGE_VALID)),
    'witness: without the marks, some page the pane reads is not drawn',
  );
  live.records = [sunRecord(plan, store.sliceOf(0))];
  live.marked.clear();
  for (const lit of pane) mark(lit);
  // What the marks ask for is what the pane reads, at the level it wants.
  assert.deepEqual(
    [...live.marked].sort((a, b) => a - b),
    read,
  );
  await run.frame(2, view, [], () => {}, [...live.marked]);
  for (const entry of read) {
    assert.ok(table[entry] & PAGE_MAPPED, `${entry} mapped in the frame that asks`);
    assert.ok(table[entry] & PAGE_VALID, `${entry} drawn: read at its own level`);
  }
}

test('a transparent pane over an unlit floor has its own shadow pages asked for and drawn', () =>
  marksItsOwnPages(({ P, N }) =>
    marks.markBlendShadows([0, 0], 0.5, [...P], [...N], false, false, footprintAt(view, P)),
  ));

test('a water surface in the sun has its own shadow pages asked for and drawn', () =>
  // From each water pixel's position and depth, through the deferred view, as the composite reads.
  marksItsOwnPages(({ P, N }) => {
    const { pixel, z } = pixelOf(P);
    marks.markWaterAt(pixel, z, [...N]);
  }));

/** The functions a fragment stage of the marks runs: its `entry` and every function it reaches. */
function reached(source: string, entry: string) {
  const defined = new Set([...source.matchAll(/\bfn (\w+)\(/g)].map((m) => m[1]));
  const seen = new Set([entry]);
  for (const name of seen)
    for (const [, callee] of functionsOf(source, [name]).matchAll(/\b(\w+)\(/g))
      if (defined.has(callee) && callee !== name) seen.add(callee);
  return seen;
}

test('the blend and water marks compile no lighting and read one material texture, its opacity', () => {
  // Neither the blend's shading nor the rest of its material, which the blend module declares:
  // no BRDF, light sum, shadow filter, map read, texture request or shadow atlas.
  const declared = (source: string) =>
    new Set([...source.matchAll(/\b(?:fn|var(?:<[^>]*>)?) (\w+)/g)].map((m) => m[1]));
  const blend = declared(blendShader()),
    marks = declared(MARKS_WGSL);
  for (const name of [
    ...['standardLighting', 'declaredLight', 'declaredLighting', 'sliceLighting'],
    ...['environmentLighting', 'bounceLighting', 'mirrorLighting', 'shadowPcf', 'blendSurface'],
    ...['dataSample', 'blendRequest', 'cotangentFrame', 'shadowAtlas', 'shadowSampler'],
  ]) {
    assert.ok(blend.has(name), `witness: the blend module declares ${name}`);
    assert.ok(!marks.has(name), `${name} in the marks`);
  }
  // Nor the water composite's lighting, refraction, reflection or backdrop (#1412).
  const composite = declared(waterCompositeShader());
  for (const name of ['waterColor', 'transmittedBackdrop', 'resolvedRadiance', 'backdrop']) {
    assert.ok(composite.has(name), `witness: the water composite declares ${name}`);
    assert.ok(!marks.has(name), `${name} in the marks`);
  }
  // One sampler, the base colour's: its alpha, read once at explicit levels, is all it samples.
  assert.deepEqual(
    [...MARKS_WGSL.matchAll(/var (\w+):sampler/g)].map((m) => m[1]),
    ['mapsSampler'],
  );
  // Either stage, the blends' and the water surfaces' (#1412): the demand, the opacity, no shading.
  for (const entry of ['markShadows', 'markWaterShadows']) {
    const stage = reached(MARKS_WGSL, entry);
    assert.ok(stage.has('demandLight') && stage.has('maskAlpha'), entry);
    assert.ok(
      ![...stage].some((name) => /^(rect|polygon|ltc)/i.test(name)),
      'no area-light shading',
    );
    const body = functionsOf(MARKS_WGSL, [...stage]);
    assert.equal(body.match(/(?<!fn )\bcolorSample\(/g)?.length, 1, `${entry}: one opacity read`);
    assert.deepEqual(
      new Set(body.match(/\btexture\w+(?=\()/g)),
      new Set(['textureSampleLevel', 'textureLoad']),
    );
    assert.equal(body.match(/\btextureSampleLevel\(\s*(?!color)/g), null, 'only the colour pool');
  }
});
