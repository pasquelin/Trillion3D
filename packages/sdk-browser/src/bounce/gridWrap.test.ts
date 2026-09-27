// Toroidal storage of the bounce probes: `sampleLevel` wraps its corner cell once and derives
// the seven neighbours' remainders from it. Run on the shader text itself, axis by axis — every
// operation involved is component-wise — against develop's per-cell remainder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/index.ts';
import { random } from '../page/cut/cutRuleChecks.fixture.ts';
import { BOUNCE_GRID_WGSL } from './gridWgsl.ts';

const I32_MIN = -(2 ** 31);
const I32_MAX = 2 ** 31 - 1;

/** The WGSL body between a header and the first line that closes it. */
const bodyOf = (header: string) => {
  const start = BOUNCE_GRID_WGSL.indexOf(header);
  assert.ok(start >= 0, `missing ${header}`);
  const from = start + header.length;
  return BOUNCE_GRID_WGSL.slice(from, BOUNCE_GRID_WGSL.indexOf('\n}', from));
};

/** A `let` initialiser of the sampling loop, as the shader writes it. */
const initialiser = (body: string, name: string) => {
  const found = body.match(new RegExp(`\\blet ${name}=(.+);`));
  assert.ok(found, `missing let ${name}`);
  return found[1];
};

/**
 * One axis of a WGSL expression as JavaScript: vector constructors become the scalar conversion,
 * `bounce.counts.x` the cube side `S`. Exact here: every value stays below 2^32 in magnitude.
 */
const scalar = (wgsl: string) =>
  wgsl
    .replace(/\bvec3u\(/g, 'u32(')
    .replace(/\bvec3i\(/g, 'i32(')
    .replace(/\b(\d+)u\b/g, '$1')
    .replace(/\bbounce\.counts\.x\b/g, 'S')
    .replace(/\blet /g, 'const ');

const sample = bodyOf('fn sampleLevel(level:u32,P:vec3f,N:vec3f)->vec4f{');
const slot = sample.match(/let slot=probeSlotWrapped\(level,(.+)\);/);
assert.ok(slot, 'sampleLevel reads its slot through probeSlotWrapped');

/** The shader's remainder of one axis of a corner's neighbour: `probeWrap`, then the loop. */
const shaderRemainder = new Function(
  `const u32=(x)=>x>>>0,i32=(x)=>x|0,select=(f,t,c)=>c?t:f;
   return (S,corner,offset)=>{
    function probeWrap(cell){${scalar(bodyOf('fn probeWrap(cell:vec3i)->vec3u{'))}}
    const wrappedCorner=${scalar(initialiser(sample, 'wrappedCorner'))};
    const wrapAt=${scalar(initialiser(sample, 'wrapAt'))};
    const next=${scalar(initialiser(sample, 'next'))};
    return ${scalar(slot[1])};
   };`,
)() as (side: number, corner: number, offset: number) => number;

/** Develop's remainder: the loop's i32 cell `corner + offset`, then `probeWrap` of that cell. */
const developRemainder = (side: number, corner: number, offset: number) => {
  const cell = (corner + offset) | 0;
  return (((cell % side) + side) % side) >>> 0;
};

/** Corners at both ends of i32, whose `+ 1` neighbour stays within it. */
const EDGE_CORNERS = [I32_MIN, I32_MIN + 1, I32_MIN + 15, I32_MAX - 16, I32_MAX - 1];

const assertSameRemainders = (side: number, corners: Iterable<number>) => {
  for (const corner of corners)
    for (const offset of [0, 1])
      assert.equal(
        shaderRemainder(side, corner, offset),
        developRemainder(side, corner, offset),
        `side ${side}, corner ${corner}, offset ${offset}`,
      );
};

test('sampleLevel wraps its corner once, outside the corner loop', () => {
  const loop = sample.slice(sample.indexOf('for(var index=0u'));
  assert.equal(loop.match(/probeWrap\(/g), null);
  assert.equal(sample.match(/probeWrap\(corner\)/g)?.length, 1);
  assert.ok(!sample.includes('probeSlot('), 'no per-corner remainder is left in sampleLevel');
});

test('the hoisted remainder equals develop on every side, around zero and on random cells', () => {
  const draw = random(927);
  const randomCorners = Array.from({ length: 512 }, () => (draw() * 2 ** 32) | 0);
  const around = Array.from({ length: 200 }, (_, index) => index - 100);
  const corners = [...around, ...EDGE_CORNERS, ...randomCorners];
  const small = Array.from({ length: 64 }, (_, index) => index + 1);
  for (const side of [...small, 1000, 65535, 2 ** 20 + 7, 2 ** 30, I32_MAX])
    assertSameRemainders(side, corners);
});

test('the hoisted remainder equals develop at the i32 wrap for a power-of-two side', () => {
  // A power-of-two side divides 2^32: the i32 cell that wraps past the largest corner still
  // has the next remainder, as develop computes it. The levels' cube side is one.
  const { cascadeSize } = BOUNCE_SETTINGS;
  assert.equal(cascadeSize & (cascadeSize - 1), 0, `cube side ${cascadeSize}`);
  for (let side = 1; side <= 2 ** 30; side *= 2) assertSameRemainders(side, [I32_MAX]);
});
