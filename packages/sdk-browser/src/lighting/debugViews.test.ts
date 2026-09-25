// Debug views are output untouched (#365): the reference never exposes nor tone maps its normal
// or depth material, so on WebGPU a normal or depth surface carries one flag through the resolve
// and the lighting pass, and the composition keeps exposure and the display curve off it — from
// the surface flag of a still image, from the share the temporal pass accumulated beside the
// colour of a jittered one. Every expression is read out of the shipped shader text and evaluated
// here on grey scalars, so a shader edit is what the tests see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AS_IS_FLAG, SURFACE_MODEL, shownAsIs } from '../scene/surfaceModel.ts';
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts';
import {
  BOUNCE_LIGHTING_SHADER,
  COMPOSE_SHADERS,
  DIRECT_LIGHTING_SHADER,
  UNLIT_COMPOSE_SHADERS,
} from './deferred/shaders.ts';
import { TAA_SHADER } from '../taa/shaderWgsl.ts';

/** The capture of `pattern` in `source`, asserted present. */
function capture(source: string, pattern: RegExp) {
  const found = source.match(pattern);
  assert.ok(found, `no line matching ${pattern}`);
  return found.slice(1);
}
/** WGSL read as JavaScript over scalars: unsigned literals lose their suffix. */
const js = (wgsl: string) => wgsl.replace(/(\d)u\b/g, '$1');
const helpers = {
  select: (f: unknown, t: unknown, c: boolean) => (c ? t : f),
  max: Math.max,
  f32: Number,
  u32: Number,
  textureLoad: (texel: number) => ({ r: texel }),
  linearToSrgb: (rgb: number) => rgb,
};
/** A stand-in display curve that bends every value, as ACES does. */
const curve = (rgb: number) => rgb / (1 + rgb);
const EXPOSURE = 0.7;

/** The composition of `shader` for one grey pixel: its HDR value and what binding 2 reads. */
function composition(shader: string) {
  const [share, curved, untouched, color] = capture(
    shader,
    /let share=(.*?);let curved=(.*?);let untouched=(.*?);\n let color=(.*?);\n/,
  ).map(js);
  const run = new Function(
    ...Object.keys(helpers),
    'toneMap',
    'asIs',
    'coord',
    'value',
    'view',
    `const share=${share};const curved=${curved};const untouched=${untouched};return ${color};`,
  );
  return (rgb: number, binding: number) =>
    run(
      ...Object.values(helpers),
      curve,
      binding,
      0,
      { rgb, a: 1 },
      {
        lightParams: { w: EXPOSURE },
        display: { x: 0 },
      },
    ) as number;
}
const still = composition(COMPOSE_SHADERS.still);
const accumulated = composition(COMPOSE_SHADERS.accumulated);

test('A normal or depth surface resolves to the as-is flag, passed through unlit', () => {
  const flagOf = new Function(
    'select',
    'model',
    `return ${js(capture(SHADE_SHADER, /vec4f\(0\.0,0\.0,0\.0,1\.0\),(select\(.*?\)),request\);\}/)[0])};`,
  ).bind(null, helpers.select);
  for (const model of Object.values(SURFACE_MODEL).filter((model) => model >= 3))
    assert.equal(flagOf(model) === AS_IS_FLAG, shownAsIs(model), `model ${model}`);
  assert.ok(shownAsIs(SURFACE_MODEL.normal) && shownAsIs(SURFACE_MODEL.depth));
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER])
    assert.match(
      shader,
      new RegExp(`if\\(flag==${AS_IS_FLAG}u\\)\\{return vec4f\\(base\\.rgb,1\\.0\\);\\}`),
    );
});

test('A still image: a debug view reaches sRGB untouched, a lit surface keeps exposure and curve', () => {
  for (const ramp of [1, 0.5, 0.25]) assert.equal(still(ramp, AS_IS_FLAG), ramp);
  for (const flag of [1, 2, 4, 5])
    assert.equal(still(2, flag), curve(2 * EXPOSURE), `flag ${flag}`);
  // The accumulated input at its two ends is the same rule, exactly.
  assert.equal(accumulated(0.5, 1), 0.5);
  assert.equal(accumulated(2, 0), curve(2 * EXPOSURE));
  // The identity chain has nothing to keep off, and reads no share.
  for (const shader of Object.values(UNLIT_COMPOSE_SHADERS))
    assert.doesNotMatch(shader, /@binding\(2\)|share/);
});

test('A jittered edge: the accumulated share follows the colour, no flip between curve and none', () => {
  // Each sample and its flag enter the filter with one weight; history is clamped and mixed with
  // the colour's weights too.
  assert.match(
    TAA_SHADER,
    /let weight=view\.weights\[k>>2u\]\[k&3u\];k\+\+;\n {2}filtered\+=sample\*weight;/,
  );
  assert.match(
    TAA_SHADER,
    new RegExp(`let asIs=f32\\(textureLoad\\(flags,at,0\\)\\.r==${AS_IS_FLAG}u\\);`),
  );
  assert.match(TAA_SHADER, /share\+=asIs\*weight;/);
  const [wcOf, whOf, colorOf, shareOf] = capture(
    TAA_SHADER,
    /let wc=(.*?);\n let wh=(.*?);\n return TaaOut\((.*?),(\(share\*wc.*?\))\);/,
  ).map(js);
  const blend = new Function(
    'alpha',
    'filtered',
    'kept',
    'share',
    'keptShare',
    `const toYcocg=(rgb)=>({x:rgb});const clamped={x:kept};
     const wc=${wcOf.replace('filtered.rgb', 'filtered')};const wh=${whOf};
     return [${colorOf},${shareOf}];`,
  ) as (...args: number[]) => [number, number];
  // One pixel on the edge of a depth view (0.5) and a lit surface (3, HDR): the jitter lands its
  // sample on one then the other, in motion (an eighth of the current frame).
  let color = 0.5,
    share = 1;
  const composed: number[] = [],
    fromFlags: number[] = [];
  for (let frame = 1; frame < 96; frame++) {
    const onDepth = frame % 2 === 0;
    [color, share] = blend(1 / 8, onDepth ? 0.5 : 3, color, onDepth ? 1 : 0, share);
    composed.push(accumulated(color, share));
    fromFlags.push(still(color, onDepth ? AS_IS_FLAG : 2));
  }
  const swing = (values: number[]) =>
    Math.max(...values.slice(32).map((value, i) => Math.abs(value - values[i + 31])));
  assert.ok(share > 0.1 && share < 0.9, `the edge settles on a blend: ${share}`);
  // The current flag alone would flip the history's colour in and out of the curve every frame.
  assert.ok(swing(fromFlags) > 0.3, `flag swing ${swing(fromFlags)}`);
  assert.ok(swing(composed) < swing(fromFlags) / 4, `share swing ${swing(composed)}`);
});
