// Proof by the real engine: `setTransform` resolves a node's parent BEFORE inverting its
// matrix, even when the host has written that parent's position, rotation and scale directly
// without ever calling `updateMatrixWorld` or going through `setTransform` again. Without that
// resolution, the same world pose asked again after a dirty parent would land elsewhere — the
// inversion would bear on a stale world matrix — and a pixel comparison would judge "no effect"
// a request that must nevertheless stay held. Making the parent singular (a zero scale) must
// refuse the request with `SINGULAR_PARENT_TRANSFORM` rather than silently pose sixteen zeros.
//
//   node --experimental-strip-types test/browser/transform-parent-perime.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'setTransformParentPerimePage.mjs',
  'setTransformParentPerime',
  'Stale parent',
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
  assert.ok(r.initialRouge > 0, dit('the initial pose shows no red pixel'));
  assert.ok(
    r.etapes.some((e) => e.nom.startsWith('initial-') && e.tenue),
    dit('the initial image was never held'),
  );
  assert.equal(
    r.etapes.find((e) => e.nom === 'parent-dirty').tenue,
    false,
    dit('hold was not broken by the dirty parent'),
  );
  assert.equal(
    r.dirtyPixels,
    0,
    dit('the same world pose asked again after a dirty parent draws elsewhere'),
  );
  assert.ok(
    r.etapes.some((e) => e.nom.startsWith('stable-') && e.tenue),
    dit('the image never restabilised'),
  );
  assert.equal(r.stablePixels, 0, dit('stabilisation moved the held pose'));
  assert.equal(r.repeatPixels, 0, dit('a second dirty then re-asked parent still draws elsewhere'));
  assert.ok(r.movedPixels > 0, dit('a truly different world pose changed nothing'));
  assert.equal(
    r.singulier,
    'SINGULAR_PARENT_TRANSFORM',
    dit('the singular parent was not refused'),
  );
}
console.log(
  `OK: 2 passes (paged, unpaged) × ${Object.values(resultat.passes)[0].etapes.length} frames ` +
    `of the real WebGPU engine — ${resultat.adaptateur}`,
);
