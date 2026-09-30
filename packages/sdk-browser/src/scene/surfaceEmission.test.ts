// #1369: the resolve loads the emission-and-occlusion texel only under its flag bit, and reads back
// exactly what the half-float target holds. The shipped writer (`emissiveAoFlag`) and reader
// (`surfaceEmissiveAo`) run as JavaScript (`shaderRun`) on edge values — zero, negative zero, what
// the half float flushes to zero or rounds to one, its largest and past it, infinities, NaN —, the
// texel stored as the target converts it (`Math.f16round`), every component compared bit for bit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts';
import { contractSurfaceBody } from '../lighting/deferred/surfaceWgsl.ts';
import { UNLIT_LIGHTING_SHADER } from '../lighting/deferred/shaders.ts';
import { shadowDemandWgsl } from '../webgpu/shadow/demandWgsl.ts';
import { EMISSIVE_AO_FLAG_WGSL, SURFACE_EMISSIVE_AO_WGSL } from './surfaceEmission.ts';
import {
  EMISSIVE_AO_SURFACE_FLAG,
  FOG_FREE_SURFACE_FLAG,
  SURFACE_MODEL_MASK,
} from './surfaceModel.ts';
import { SUBSURFACE_FLAG } from './subsurface.ts';

type Texel = number[];
/** The half float the target stores a value as: round to nearest, ties to even. */
const f16 = (Math as Math & { f16round: (x: number) => number }).f16round;
const EDGES = [0, -0, 1e-9, 2 ** -24, 6e-5, 0.5, 1, 1 + 2 ** -12, 65504, 7e4, Infinity, -1, NaN];
const AOS = [1, 1 - 2 ** -13, 1 + 2 ** -12, 0.999, 0.5, 0, -0, NaN, Infinity];

/** The shipped pair, the target's texel given to the reader. */
function roundTrip(emissive: number[], ao: number, flag: number) {
  const texel: Texel = [...emissive, ao].map(f16);
  const scope = { emissiveAo: texel, textureLoad: (t: Texel) => t };
  const { emissiveAoFlag } = shaderRun<{ emissiveAoFlag: (e: number[], a: number) => number }>(
    EMISSIVE_AO_FLAG_WGSL,
    ['emissiveAoFlag'],
    scope,
  );
  const { surfaceEmissiveAo } = shaderRun<{ surfaceEmissiveAo: (c: number[], f: number) => Texel }>(
    SURFACE_EMISSIVE_AO_WGSL,
    ['surfaceEmissiveAo'],
    scope,
  );
  const written = flag | emissiveAoFlag(emissive, ao);
  return { written, texel, read: surfaceEmissiveAo([3, 4], written) };
}

test('the texel read back is the stored one, bit for bit, set or skipped', () => {
  let skipped = 0,
    fetched = 0;
  for (const flag of [1, 2, 4, 5, 2 | SUBSURFACE_FLAG | FOG_FREE_SURFACE_FLAG])
    for (const e of EDGES)
      for (const ao of AOS)
        for (const emissive of [
          [e, 0, 0],
          [0, e, 0],
          [0, 0, e],
          [e, e, e],
        ]) {
          const { written, texel, read } = roundTrip(emissive, ao, flag);
          const where = `emission ${emissive}, occlusion ${ao}, flag ${flag}`;
          assert.equal(written & ~EMISSIVE_AO_SURFACE_FLAG, flag, `the other marks kept: ${where}`);
          assert.equal(written & SURFACE_MODEL_MASK, flag & SURFACE_MODEL_MASK);
          assert.ok(
            read.every((v, i) => Object.is(v, texel[i])),
            `${read} for ${texel}: ${where}`,
          );
          if (written & EMISSIVE_AO_SURFACE_FLAG) fetched++;
          else skipped++;
        }
  assert.ok(skipped > 0 && fetched > skipped, `${skipped} skipped, ${fetched} fetched`);
  assert.equal(roundTrip([0, 0, 0], 1, 2).written, 2, 'no emission, full occlusion: no fetch');
  assert.equal(roundTrip([-0, 0, 0], 1, 2).written, 2 | EMISSIVE_AO_SURFACE_FLAG, 'negative zero');
});

test('the material pass writes the bit; the resolve and the unlit view fetch through it alone', () => {
  const lit =
    /return SurfaceOut\(vec4f\(rgb,metal\),vec4f\(N,rough\),vec4f\(emissive,ao\),flag\|emissiveAoFlag\(emissive,ao\),request\);/;
  assert.match(SHADE_SHADER, lit);
  assert.match(SHADE_SHADER, /fn emissiveAoFlag\(/);
  for (const reader of [contractSurfaceBody(''), UNLIT_LIGHTING_SHADER]) {
    assert.doesNotMatch(reader.replace(SURFACE_EMISSIVE_AO_WGSL, ''), /textureLoad\(emissiveAo/);
    assert.match(reader, /surfaceEmissiveAo\(coord,(surfaceFlag|flag)\)/);
  }
});

test('the shadow demand reads the model under the bit: an unlit surface that emits asks nothing', () => {
  const mask = Number(
    /let flag=textureLoad\(flags,coord,0\)\.r&(\d+)u;/.exec(shadowDemandWgsl())?.[1],
  );
  assert.equal(mask, SURFACE_MODEL_MASK, 'the model bits alone, as the resolve reads them');
  assert.equal((1 | EMISSIVE_AO_SURFACE_FLAG) & mask, 1, 'an unlit emissive pixel stays unlit');
  assert.equal((2 | EMISSIVE_AO_SURFACE_FLAG | SUBSURFACE_FLAG) & mask, 2);
});
