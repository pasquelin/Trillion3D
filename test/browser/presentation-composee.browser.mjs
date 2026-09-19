// Proof of the composed presentation: a host surface in WebGL2 receives the image the engine
// presented on its own canvas, copied by the engine's own program. No texture, material or mesh
// of the host's rendering library takes part, and the copy must be exact — a single channel off
// would mean a colour conversion crept back in, a flipped row that the image is upside down.
//
// Both destinations are exercised, because they do not encode the same way: the page's own
// framebuffer, which writes the byte as it is, and an sRGB render target, which the driver
// encodes on every write — what a host comparison layout draws into.
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

assert.equal(resultat.checks.length, 2, 'both destinations were not exercised');
for (const copie of resultat.checks)
  assert.equal(
    copie.differentChannels,
    0,
    `${copie.name}: ${copie.differentChannels} channels differ (max ${copie.maxChannelError})`,
  );
console.log(`OK: ${resultat.checks[0].bytes} channels copied to each destination, not one apart`);
