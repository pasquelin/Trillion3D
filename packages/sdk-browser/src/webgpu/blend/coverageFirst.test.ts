// A transparent fragment the material rejects — its alpha test, the side a doubtful triangle does
// not draw, a dashed line's gap — reads its base colour and nothing more: no map, no light. A
// `discard` alone only demotes the invocation to a helper, which a backend runs to its end; the
// blend and water stages return after it (`shaderSurface.ts`). Every derivative is taken before
// that return, in uniform control flow, so a kept fragment's quad reads the derivatives it read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { functionsOf } from '../../texture/shaderRule.fixture.ts';
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts';
import { WATER_SURFACE_WGSL } from '../water/surfaceWgsl.ts';
import { FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts';
import { FACING_SHIFT } from './facing.ts';

const DERIVATIVE = /\b(?:dpdx|dpdy|fwidth)(?:Fine|Coarse)?\(|\btextureSample(?:Bias|Compare)?\(/;
const COVERAGE = /if\(!blendKeeps\([^{]*\)\{discard;return /;
const STAGES = BLEND_SHADER + WATER_SURFACE_WGSL;

test('the blend and water stages take every derivative before their coverage test returns', () => {
  const taking = [...STAGES.matchAll(/fn (\w+)\(/g)]
    .map(([, name]) => name)
    .filter((name) => DERIVATIVE.test(functionsOf(STAGES, [name])));
  assert.deepEqual(taking, ['blendGrads', 'blendFragment']);
  for (const stage of ['blendFragment', 'fsWater']) {
    const body = functionsOf(STAGES, [stage]),
      coverage = body.search(COVERAGE);
    assert.ok(coverage > 0, `${stage} returns at its coverage test`);
    assert.ok(body.indexOf('blendGrads(in)') < coverage, `${stage} takes the derivatives first`);
    assert.doesNotMatch(body.slice(coverage), DERIVATIVE);
  }
});

/** The blend fragment stage run in JavaScript, its reads and lights counted. */
function runBlendFragment(alpha: number, flags: number, facing = 0, dash = [0, 0]) {
  const counts = { color: 0, data: 0, lights: 0, discarded: 0 };
  const names = [
    'blendFragment',
    'blendGrads',
    'blendBase',
    'blendKeeps',
    'blendAlpha',
    'blendSampled',
    'blendSurface',
    'blendGeometricNormal',
    'facingDiscarded',
    'lineDash',
    'blendShadowFootprint',
  ];
  const zero = (v: number[]) => v.map(() => 0);
  const lit = () => (counts.lights++, [0.25, 0.25, 0.25]);
  const scope = {
    discarded: () => void counts.discarded++,
    dpdx: zero,
    dpdy: zero,
    fwidth: zero,
    colorSample: () => (counts.color++, [0.5, 0.5, 0.5, alpha]),
    dataSample: () => (counts.data++, [1, 1, 1, 1]),
    blendRequest: () => 7,
    uniteOuZero: (v: number[]) => v,
    declaredLighting: lit,
    bounceLighting: lit,
    environmentLighting: lit,
    mirrorLighting: lit,
    fogged: (rgb: number[]) => rgb,
    shadowSetView: () => undefined,
    displayRoute: () => ({ keep: 1, tint: [1, 1, 1, 1], add: [0, 0, 0, 0] }),
    BlendGrads: (gradX: number[], gradY: number[], q0: number[], q1: number[]) => ({
      gradX,
      gradY,
      q0,
      q1,
    }),
    BlendSurface: (...v: unknown[]) => ({
      rgb: v[0],
      alpha: v[1],
      N: v[2],
      rough: v[3],
      metal: v[4],
      ao: v[5],
      emissive: v[6],
      request: v[7],
      subsurface: v[8],
    }),
    BlendOut: (color: number[], request: number) => ({ color, request }),
    uni: { camPos: [0, 0, 5, 1], viewport: [64, 64], pixelScale: 0.01, eye: [0, 0, 5] },
    surfaceModel: 0,
    thinSubsurface: [0, 0, 0],
    shadowFootprint: 0,
  };
  // `discard` demotes and goes on: counted, it runs as a helper would.
  const text = BLEND_SHADER.replace(/\bdiscard;/g, 'discarded();');
  const run = shaderRun<{ blendFragment: (...a: unknown[]) => { color: number[] } }>(
    text,
    names,
    scope,
  );
  const fragment = {
    ids: [1, flags, 0],
    uv: [0.25, 0.75],
    view: [0, 0, 0],
    bary: [1, 0, 0],
    color: [1, 1, 1, 1],
    alphaAo: [0.5, 1, ...dash],
    water: facing << FACING_SHIFT,
    maps: [2, 3, 0, 4],
    pbr: [0.5, 0.25, 1, 1],
    emissive: [0, 0, 0, 0],
    normal: [0, 0, 1, 0],
    tangent: [1, 0, 0, 0],
    bitangent: [0, 1, 0, 0],
    position: [10, 10, 0.5, 1],
  };
  const out = run.blendFragment(fragment, true, 0);
  return { counts, out };
}

test('a fragment the material rejects reads its base colour alone, and lights nothing', () => {
  const LIT = 1;
  // Below the alpha test, the side a doubtful front face does not draw, a dash's gap.
  for (const rejected of [
    runBlendFragment(0.25, LIT),
    runBlendFragment(1, LIT, 1),
    runBlendFragment(1, LIT, 0, [0.1, 0.5]),
  ])
    assert.deepEqual(rejected.counts, { color: 1, data: 0, lights: 0, discarded: 1 });
  // A kept fragment reads its three maps and lights itself: four light terms, nothing discarded.
  assert.deepEqual(runBlendFragment(1, LIT).counts, { color: 1, data: 3, lights: 4, discarded: 0 });
  const unlit = runBlendFragment(0.75, FLAG_UNLIT_VIEW);
  assert.deepEqual(unlit.counts, { color: 1, data: 3, lights: 0, discarded: 0 });
  assert.deepEqual(unlit.out.color, [0.5, 0.5, 0.5, 0.75]);
});
