// Proof by the real render: the held WebGL image does not retouch colour, on the engine's own
// surface. Canvas pixels are reread just after the complete image, then after several held
// images, with and without a light.
//
// Two defects this proof closes: the draw-buffer copy once presented with no declared colour
// space and tone mapping active — already encoded values reread as linear then re-encoded, the
// held image brightening at every presentation —, and the copy itself, `copyTexSubImage2D` into
// an RGBA texture, refused on the engine's `alpha: false` drawing buffer: every held frame of
// `exact-cluster-pages` showed black (#85). The engine now blits, and the witness draws itself.
//
//   node --experimental-strip-types tests/browser/renders/held-colour-image.browser.ts
import assert from 'node:assert/strict';
import { preuveDansLaPage, type ResultatPagePreuve } from '../support/enginePageProof.ts';

interface CasCouleur {
  eclairee: boolean;
  complete: number[][];
  tenues: number[][][];
  dessins: number;
  dessinsTenus: number;
}

interface Resultat extends ResultatPagePreuve {
  alpha?: boolean;
  cas?: CasCouleur[];
}

const resultat = (await preuveDansLaPage(
  'heldColourImagePage.ts',
  'imageTenueCouleur',
  'Held WebGL image and colour pipeline',
)) as Resultat;
console.log(JSON.stringify(resultat, null, 2));
assert.equal(resultat.erreur ?? null, null, String(resultat.erreur));
assert.deepEqual(resultat.erreurs, []);

assert.equal(resultat.alpha, false, 'the proof runs on the engine surface, without alpha');
const cas = resultat.cas ?? [];
assert.equal(cas.length, 2, 'the proof measures the unlit case and the lit case');
for (const { eclairee, complete, tenues, dessins, dessinsTenus } of cas) {
  const nom = eclairee ? 'avec lampe' : 'sans lampe';
  // The proof only holds if the complete image is not uniformly black or white: without a
  // discrepancy between its points, a re-encode would go unnoticed.
  assert.ok(
    new Set(complete.map((px) => px.join(','))).size > 1,
    `${nom}: the complete image has only one value, the proof would be empty`,
  );
  for (const [rang, tenue] of tenues.entries())
    assert.deepEqual(tenue, complete, `${nom}: held image ${rang} differs from the complete image`);
  assert.ok(dessins > 0, `${nom}: the complete image drew the scene`);
  assert.equal(dessinsTenus, dessins, `${nom}: a held image draws nothing of the scene`);
}
