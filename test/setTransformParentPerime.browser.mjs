// Preuve par le moteur réel : `setTransform` résout le parent d'un nœud AVANT d'inverser sa
// matrice, même quand l'hôte a écrit directement la position, la rotation et l'échelle de ce parent
// sans jamais appeler `updateMatrixWorld` ni repasser par `setTransform`. Sans cette résolution, la
// même pose monde redemandée après un parent sali finirait ailleurs — l'inversion porterait sur une
// matrice monde périmée — et une comparaison au pixel jugerait « sans effet » une demande qui,
// pourtant, doit rester tenue. Rendre le parent singulier (une échelle à zéro) doit refuser la
// demande par `SINGULAR_PARENT_TRANSFORM` plutôt que de poser silencieusement seize zéros.
//
//   LAB_ROOT=… node --experimental-strip-types test/setTransformParentPerime.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from './preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'setTransformParentPerimePage.mjs',
  'setTransformParentPerime',
  'Parent périmé',
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
  const dit = (message) => `${passe} : ${message}`;
  assert.ok(r.initialRouge > 0, dit('la pose initiale ne montre aucun pixel rouge'));
  assert.ok(
    r.etapes.some((e) => e.nom.startsWith('initial-') && e.tenue),
    dit('l’image initiale ne s’est jamais tenue'),
  );
  assert.equal(
    r.etapes.find((e) => e.nom === 'parent-dirty').tenue,
    false,
    dit('la tenue n’a pas été cassée par le parent sali'),
  );
  assert.equal(
    r.dirtyPixels,
    0,
    dit('la même pose monde redemandée après un parent sali dessine ailleurs'),
  );
  assert.ok(
    r.etapes.some((e) => e.nom.startsWith('stable-') && e.tenue),
    dit('l’image ne s’est jamais restabilisée'),
  );
  assert.equal(r.stablePixels, 0, dit('la stabilisation a bougé la pose tenue'));
  assert.equal(
    r.repeatPixels,
    0,
    dit('un second parent sali puis redemandé dessine encore ailleurs'),
  );
  assert.ok(r.movedPixels > 0, dit('une pose monde réellement différente n’a rien changé'));
  assert.equal(
    r.singulier,
    'SINGULAR_PARENT_TRANSFORM',
    dit('le parent singulier n’a pas été refusé'),
  );
}
console.log(
  `OK : 2 passes (paginée, non paginée) × ${Object.values(resultat.passes)[0].etapes.length} images ` +
    `du moteur WebGPU réel — ${resultat.adaptateur}`,
);
