// A transmissive surface is composed by the water pass — surface buffer, then one fullscreen
// composite on the frozen backdrop — and the image it yields is the one the material equations
// predict, paged as unpaged (`waterPassPage.ts`).
//
// Four cases, each read at the tile's centre where the view is face-on: a basin whose declared
// thickness is the ground's depth; the same basin declared five times deeper, which must render
// the same pixel because the volume ends where the opaque scene begins; a surface in front of
// nothing, which must let the display background through instead of a black radiance; and the
// same tile with no transmission, which stays an ordinary blend. Every case then holds its image:
// no work in a still scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { preuveDansLaPage, preuveSaine, type ResultatPagePreuve } from '../kit/enginePageProof.ts';
import { BACKGROUND, GROUND, WATER } from './waterPassCases.ts';

interface WaterCaseReading {
  name: string;
  paged: boolean;
  centre: number[];
  drawsFirst: number;
  moved: number[];
  heldLast: boolean;
  drawsLast: number;
}

interface Result extends ResultatPagePreuve {
  cases?: WaterCaseReading[];
}

/** Display value of a linear channel, as the unlit composition encodes it. */
const srgb = (c: number) =>
  Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
/** Fresnel at normal incidence: what the face-on centre reflects, and does not transmit. */
const f0 = ((WATER.ior - 1) / (WATER.ior + 1)) ** 2;
/** The basin's centre: the ground, tinted, attenuated over its depth, less the reflected share. */
const basin = GROUND.color.map((ground, i) => {
  const sigma = -Math.log(WATER.attenuationColor[i]) / WATER.attenuationDistance;
  return srgb((1 - f0) * WATER.tint[i] * ground * Math.exp(-sigma * GROUND.depth));
});
/** In front of nothing, the transmitted share covers nothing: the background stays, less Fresnel. */
const nothing = [BACKGROUND >> 16, (BACKGROUND >> 8) & 255, BACKGROUND & 255].map((c) =>
  Math.round(c * (1 - f0)),
);
const EXPECTED: Record<string, number[]> = {
  basin,
  'declared-deeper': basin,
  'nothing-behind': nothing,
  blend: WATER.tint.map(srgb),
};
/** Display levels the composition may round to on a channel. */
const TOLERANCE = 3;

test('the water pass composes the predicted image and holds it, paged and unpaged', async () => {
  const result = (await preuveDansLaPage(
    resolve(import.meta.dirname, 'waterPassPage.ts'),
    'waterPass',
    'run',
  )) as Result;
  preuveSaine(result);
  const cases = result.cases ?? [];
  assert.equal(cases.length, 8, 'four cases, paged and unpaged');
  for (const c of cases) {
    const name = `${c.name} (${c.paged ? 'paged' : 'unpaged'})`;
    const want = EXPECTED[c.name];
    c.centre.forEach((value, i) =>
      assert.ok(
        Math.abs(value - want[i]) <= TOLERANCE,
        `${name}: centre ${c.centre} differs from the predicted ${want}`,
      ),
    );
    assert.ok(c.drawsFirst >= 1, `${name}: the surface was not drawn`);
    assert.deepEqual(c.moved, [0, 0, 0, 0], `${name}: the still image moved between frames`);
    assert.equal(c.heldLast, true, `${name}: the still image was never held`);
    assert.equal(c.drawsLast, 0, `${name}: a held image still drew`);
  }
});
