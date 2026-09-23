// Proof of the composed presentation: a host surface in WebGL2 receives the image the engine
// presented on its own canvas, copied by the engine's own program. No texture, material or mesh
// of the host's rendering library takes part, and the copy must be exact — a single channel off
// would mean a colour conversion crept back in, a flipped row that the image is upside down.
//
// The destination is the page's own framebuffer, which writes the byte as it is — the host's
// comparison targets store display bytes the same way (#85).
//
//   node --experimental-strip-types tests/browser/renders/composed-presentation.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/enginePageProof.ts';

interface CopieVerifiee {
  name: string;
  differentChannels: number;
  maxChannelError: number;
  bytes: number;
}

interface Resultat extends ResultatPagePreuve {
  checks: CopieVerifiee[];
}

const resultat = (await preuveDansLaPage(
  'composedPresentationPage.ts',
  'presentationComposee',
  'Composed presentation',
)) as Resultat;
console.log(JSON.stringify(resultat, null, 2));
preuveSaine(resultat);

assert.equal(resultat.checks.length, 1, 'the copy was not exercised');
for (const copie of resultat.checks)
  assert.equal(
    copie.differentChannels,
    0,
    `${copie.name}: ${copie.differentChannels} channels differ (max ${copie.maxChannelError})`,
  );
console.log(`OK: ${resultat.checks[0].bytes} channels copied to the surface, not one apart`);
