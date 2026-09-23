// The transport experiment's observation drawn by the engine's program: the image the host
// shader material drew, from the same records, and the public backend composed like any engine.
//
//   node --experimental-strip-types tests/browser/renders/lighting-observation-webgl.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/enginePageProof.ts';

interface Comparaison {
  max: number;
  differing: number;
}

interface Resultat extends ResultatPagePreuve {
  litPixels: number;
  againstWitness: Comparaison;
  composedAgainstEngine: Comparaison;
  drawCalls?: number;
  triangles?: number;
  meshesInHostScene: number;
  renderer: string;
}

/** One byte in a hundred may sit on a rounding boundary of the two sRGB exponents. */
const BOUNDARY_BUDGET = (96 * 96 * 4) / 100;
const result = (await preuveDansLaPage(
  'lightingObservationPage.ts',
  'lightingObservationProof',
  'Lighting observation on the engine program',
  'execute',
)) as Resultat;
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.ok(result.litPixels > 2000, 'the rectangles and the sphere fill the view');
// Same GLSL, same records: the two renderers agree to the last bit, the sRGB transfer's
// exponent (1/2.4 here, 0.41666 on the host) allowed one level on a boundary.
assert.ok(result.againstWitness.max <= 1, `witness differs by ${result.againstWitness.max}`);
assert.ok(result.againstWitness.differing < BOUNDARY_BUDGET, 'more than boundary levels differ');
assert.deepEqual(
  result.composedAgainstEngine,
  { max: 0, differing: 0 },
  'the composer draws the same',
);
assert.equal(result.drawCalls, 4, 'three rectangles and the sphere');
assert.equal(result.meshesInHostScene, 0, 'no observation mesh enters the host scene');
assert.match(result.renderer, /^Engine WebGL2/);
