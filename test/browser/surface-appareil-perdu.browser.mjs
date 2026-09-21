// Proof by the real engine that a lost WebGPU device leaves nothing stale to present. The
// engine presents into a canvas of its own and publishes it as `presentedSurface`; once the
// device is destroyed, that canvas must be withdrawn and read back blank, the next render must
// raise `WEBGPU_LOST`, and the loss must be announced under that name. Before the loss the image
// holds the fixture's triangles: a stale copy would have carried them.
//
//   node --experimental-strip-types test/browser/surface-appareil-perdu.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'surfaceAppareilPerduPage.mjs',
  'surfaceAppareilPerdu',
  'Lost device presents nothing stale',
);
console.log(JSON.stringify(resultat, null, 2));
preuveSaine(resultat);

assert.ok(resultat.avant > 0, 'the image held nothing before the loss: the proof is empty');
assert.equal(resultat.publiee, false, 'the canvas of a lost device is still published');
assert.equal(resultat.apres, 0, `${resultat.apres} stale channels still presented after the loss`);
assert.equal(resultat.frameHeld, false, 'a frame of the lost device is still held');
assert.match(
  resultat.erreurRendu ?? '',
  /WEBGPU_LOST/,
  'the next render did not raise WEBGPU_LOST',
);
assert.equal(resultat.perte?.context.code, 'WEBGPU_LOST', JSON.stringify(resultat.perte));
console.log(`OK: ${resultat.avant} lit channels before the loss, none after`);
