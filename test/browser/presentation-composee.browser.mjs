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

const [copie] = resultat.checks;
assert.ok(copie, 'the copy did not run');
assert.equal(
  copie.differentChannels,
  0,
  `${copie.differentChannels} channels differ (max ${copie.maxChannelError})`,
);
console.log(`OK: ${copie.bytes} channels copied, not one apart`);
