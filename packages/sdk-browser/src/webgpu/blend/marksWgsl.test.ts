// #1411: a transparent pane over an unlit opaque floor. The floor's pixels ask for no shadow page;
// the pane's marks, run from the shipped marks WGSL through `shaderRun`, ask for the pages its
// shading reads (`shadingReads.fixture.ts`), and the GPU maps and draws them in the frame that asks
// (`gpuFrames.fixture.ts`): the pane reads the level it asked for, never a coarser one.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ShadowViewpoint } from '../../../../sdk-core/src/index.ts';
import { SUN, VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelSignatures.ts';
import { PAGE_MAPPED, PAGE_VALID } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { functionsOf, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
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

type V = number[];
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
}>(
  MARKS_WGSL,
  [
    'markBlendShadows',
    'demandSlice',
    'demandLight',
    'demandSun',
    'demandPages',
    'demandPage',
    'shadowPageEntry',
    'sunOrigin',
    'sunReadAt',
    'shadowNormalTexels',
    ...PAGE_MODEL_FUNCTIONS,
  ],
  {
    ...K,
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

/** The camera looking down the floor, and the pane a metre above it, its normal up. */
const view: ShadowViewpoint = { ...VIEW, position: [0, 4, 2], forward: [0, -0.3, -0.954] };
const pane: Lit[] = floorTiles(tileGrid(-2, 2, -10, -8), 3).lits.map(({ P, N }) => ({
  P: [P[0], 1, P[2]],
  N,
}));

test('a transparent pane over an unlit floor has its own shadow pages asked for and drawn', async () => {
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
  for (const { P, N } of pane) {
    marks.markBlendShadows([0, 0], 0.5, [...P], [...N], false, false, footprintAt(view, P));
  }
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
});

/** The functions the marks' fragment stage runs: `markShadows` and every function it reaches. */
function reached(source: string) {
  const defined = new Set([...source.matchAll(/\bfn (\w+)\(/g)].map((m) => m[1]));
  const seen = new Set(['markShadows']);
  for (const name of seen)
    for (const [, callee] of functionsOf(source, [name]).matchAll(/\b(\w+)\(/g))
      if (defined.has(callee) && callee !== name) seen.add(callee);
  return seen;
}

test('the marks compile no lighting and read one material texture, its opacity', () => {
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
  // One sampler, the base colour's: its alpha, read once at explicit levels, is all it samples.
  assert.deepEqual(
    [...MARKS_WGSL.matchAll(/var (\w+):sampler/g)].map((m) => m[1]),
    ['mapsSampler'],
  );
  const stage = reached(MARKS_WGSL);
  assert.ok(stage.has('demandLight') && stage.has('maskAlpha'));
  assert.ok(![...stage].some((name) => /^(rect|polygon|ltc)/i.test(name)), 'no area-light shading');
  const body = functionsOf(MARKS_WGSL, [...stage]);
  assert.equal(body.match(/(?<!fn )\bcolorSample\(/g)?.length, 1, 'one opacity read');
  assert.deepEqual(
    new Set(body.match(/\btexture\w+(?=\()/g)),
    new Set(['textureSampleLevel', 'textureLoad']),
  );
  assert.equal(body.match(/\btextureSampleLevel\(\s*(?!color)/g), null, 'only the colour pool');
});
