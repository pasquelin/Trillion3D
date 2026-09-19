// Proof by the real render: the held WebGL image does not retouch colour. Canvas pixels are
// reread just after the complete image, then after several held images, with and without a light.
//
// Before the fix, the draw-buffer copy was presented with no declared colour space and with tone
// mapping active: already encoded values were reread as linear then re-encoded, and the held
// image brightened at every presentation.
//
//   node --experimental-strip-types test/browser/image-tenue-couleur.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'imageTenueCouleurPage.mjs',
  'imageTenueCouleur',
  'Held WebGL image and colour pipeline',
);
console.log(JSON.stringify(resultat, null, 2));
assert.equal(resultat.erreur ?? null, null, String(resultat.erreur));
assert.deepEqual(resultat.erreurs, []);

const cas = resultat.cas ?? [];
assert.equal(cas.length, 2, 'the proof measures the unlit case and the lit case');
for (const { eclairee, complete, tenues } of cas) {
  const nom = eclairee ? 'avec lampe' : 'sans lampe';
  // The proof only holds if the complete image is not uniformly black or white: without a
  // discrepancy between its points, a re-encode would go unnoticed.
  assert.ok(
    new Set(complete.map((px) => px.join(','))).size > 1,
    `${nom}: the complete image has only one value, the proof would be empty`,
  );
  for (const [rang, tenue] of tenues.entries())
    assert.deepEqual(tenue, complete, `${nom}: held image ${rang} differs from the complete image`);
}
