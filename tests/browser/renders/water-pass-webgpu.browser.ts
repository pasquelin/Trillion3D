// Proof by the real engine: a transmissive surface is composed by the water pass — surface
// buffer, then one fullscreen composite on the frozen backdrop — and the image it yields is the
// one the material equations predict, paged as unpaged.
//
// Four cases, each read at the tile's centre where the view is face-on: a basin whose declared
// thickness is the ground's depth; the same basin declared five times deeper, which must render
// the same pixel because the volume ends where the opaque scene begins; a surface in front of
// nothing, which must let the display background through instead of a black radiance; and the
// same tile with no transmission, which stays an ordinary blend. Every case then holds its
// image: no work in a still scene.
//
//   node --experimental-strip-types tests/browser/renders/water-pass-webgpu.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/enginePageProof.ts';
import { BACKGROUND, GROUND, WATER } from '../support/waterPassCases.ts';

interface CasEau {
  name: string;
  pagine: boolean;
  centre: number[];
  drawsFirst: number;
  moved: number[];
  heldLast: boolean;
  drawsLast: number;
}

interface Resultat extends ResultatPagePreuve {
  adaptateur?: string;
  cases?: CasEau[];
}

const resultat = (await preuveDansLaPage(
  'waterPassPage.ts',
  'waterPass',
  'Water pass',
)) as Resultat;
console.log(JSON.stringify({ adaptateur: resultat.adaptateur, cases: resultat.cases }, null, 2));
preuveSaine(resultat);

/** Display value of a linear channel, as the unlit composition encodes it. */
const srgb = (c: number) =>
  Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
/** Fresnel at normal incidence: what the face-on centre reflects, and does not transmit. */
const f0 = ((WATER.ior - 1) / (WATER.ior + 1)) ** 2;
/** The basin's centre: the ground, tinted, attenuated over its depth, less the reflected share. */
const basin = GROUND.color.map((ground: number, i: number) => {
  const sigma = -Math.log(WATER.attenuationColor[i]) / WATER.attenuationDistance;
  return srgb((1 - f0) * WATER.tint[i] * ground * Math.exp(-sigma * GROUND.depth));
});
/** In front of nothing, the transmitted share covers nothing: the background stays, less Fresnel. */
const nothing = [BACKGROUND >> 16, (BACKGROUND >> 8) & 255, BACKGROUND & 255].map((c) =>
  Math.round(c * (1 - f0)),
);
const blend = WATER.tint.map(srgb);
const expected: Record<string, number[]> = {
  basin,
  'declared-deeper': basin,
  'nothing-behind': nothing,
  blend,
};
const TOLERANCE = 3;

const cases = resultat.cases ?? [];
assert.equal(cases.length, 8, 'four cases, paged and unpaged');
for (const c of cases) {
  const nom = `${c.name} (${c.pagine ? 'paged' : 'unpaged'})`;
  const want = expected[c.name];
  for (const [i, value] of c.centre.entries())
    assert.ok(
      Math.abs(value - want[i]) <= TOLERANCE,
      `${nom}: centre ${c.centre} differs from the predicted ${want}`,
    );
  assert.ok(c.drawsFirst >= 1, `${nom}: the surface was not drawn`);
  assert.deepEqual(c.moved, [0, 0, 0, 0], `${nom}: the still image moved between frames`);
  assert.equal(c.heldLast, true, `${nom}: the still image was never held`);
  assert.equal(c.drawsLast, 0, `${nom}: a held image still drew`);
}
console.log(`OK: ${cases.length} water cases of the real WebGPU engine — ${resultat.adaptateur}`);
