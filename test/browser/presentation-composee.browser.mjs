// Proof of the composed presentation: a host surface in WebGL2 receives the image the engine
// presented on its own canvas, copied by the engine's own program. No texture, material or mesh
// of the host's rendering library takes part, and the copy must be exact — a single channel off
// would mean a colour conversion crept back in, a flipped row that the image is upside down.
//
//   node --experimental-strip-types test/browser/presentation-composee.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'presentationComposeePage.mjs',
  'presentationComposee',
  'Composed presentation',
);
console.log(JSON.stringify(resultat, null, 2));
preuveSaine(resultat);

assert.equal(resultat.glError, 0, `the copy raised WebGL error ${resultat.glError}`);
assert.equal(resultat.maxCanal, 0, 'a channel of the presented image changed on the way');
assert.equal(resultat.pixels, 0, `${resultat.pixels} pixels differ from the presented image`);
console.log(`OK: ${resultat.total} pixels copied, not one channel apart`);
