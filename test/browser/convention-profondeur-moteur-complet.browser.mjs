// Proof by the real engine: the same physical camera (near 2.8, far 12), a tilted tile that
// crosses the near plane, rendered while the host flips its clip convention — `[−1, 1]` on the
// WebGL side, `[0, 1]` on the WebGPU side — yields the same image pixel for pixel, both ways.
// Since the "reversed Z" batch, the engine no longer reads that convention: it composes its own
// projection, in reversed depth and infinite far plane. The flip therefore changes NONE of the
// engine's numbers, and the held image must stay held — that is what this test checks.
//
//   node --experimental-strip-types test/browser/convention-profondeur-moteur-complet.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'depthConventionMoteurCompletPage.mjs',
  'depthConventionMoteurComplet',
  'Depth convention',
);
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, passes: resultat.passes, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

for (const [passe, r] of Object.entries(resultat.passes)) {
  const dit = (message) => `${passe}: ${message}`;
  assert.ok(r.rougeWebgl > 0, dit('the tilted tile is not visible under the WebGL convention'));
  assert.ok(
    r.etapes.some((e) => e.name.startsWith('webgl-') && e.tenue),
    dit('the WebGL image was never held'),
  );
  assert.equal(
    r.etapes.find((e) => e.name === 'webgpu-0').tenue,
    true,
    dit('switching to WebGPU triggered recomputing an image that nothing changed'),
  );
  assert.equal(r.versWebgpu, 0, dit('the WebGPU convention draws something different than WebGL'));
  assert.equal(
    r.etapes.find((e) => e.name === 'retour-0').tenue,
    true,
    dit('returning to WebGL triggered recomputing an image that nothing changed'),
  );
  assert.equal(r.versRetour, 0, dit('the return to WebGL does not restore the same image'));
}
console.log(
  `OK: 2 passes (paged, unpaged) × ${Object.values(resultat.passes)[0].etapes.length} frames ` +
    `of the real WebGPU engine — ${resultat.adaptateur}`,
);
