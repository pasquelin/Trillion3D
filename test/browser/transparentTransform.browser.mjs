// Preuve par le moteur réel : un objet transparent déplacé par l'API publique `setTransform` change
// de place à l'image, paginé comme non paginé, par son propre nœud comme par son parent, sous une
// matrice cisaillée, hors du champ et au retour, y compris après stabilisation de l'image tenue.
//
// La page (`test/browserFixtures/transparentTransformPage.mjs`) est empaquetée par esbuild — celui
// de Vite, pris dans `render-tech-lab` en lecture seule — et exécutée dans Chromium avec un vrai
// appareil WebGPU. Rien n'est simulé : `webgpuPagesBackend`, ses passes et sa relecture d'image.
//
//   node --experimental-strip-types test/browser/transparentTransform.browser.mjs
//   (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'transparentTransformPage.mjs',
  'transparentTransform',
  'Transparent déplacé',
);
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, passes: resultat.passes, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

/** Les trois sondes de la page : gauche, droite, coin haut-droit du carreau cisaillé. */
const [GAUCHE, DROITE, COIN] = [0, 1, 2];

for (const [passe, etapes] of Object.entries(resultat.passes)) {
  const de = (nom) => etapes.find((e) => e.nom === nom) ?? assert.fail(`${passe}: ${nom} absent`);
  const dit = (nom, message) => `${passe} / ${nom} : ${message}`;
  const gauche = de('gauche');
  assert.ok(gauche.rouge[GAUCHE], dit('gauche', 'le transparent n’est pas à gauche'));
  assert.ok(!gauche.rouge[DROITE], dit('gauche', 'le transparent est aussi à droite'));
  const droite = de('droite');
  assert.ok(droite.rouge[DROITE], dit('droite', 'setTransform n’a pas déplacé le transparent'));
  assert.ok(!droite.rouge[GAUCHE], dit('droite', 'le transparent est resté à gauche'));
  const parent = de('parent-gauche');
  assert.ok(parent.rouge[GAUCHE], dit('parent-gauche', 'le parent n’emporte pas son enfant'));
  assert.ok(!parent.rouge[DROITE], dit('parent-gauche', 'l’enfant est resté à droite'));
  const cisaille = de('cisaille');
  assert.ok(cisaille.rouge[COIN], dit('cisaille', 'le cisaillement est perdu au dessin'));
  const hors = de('hors-champ');
  assert.ok(
    !hors.rouge[GAUCHE] && !hors.rouge[DROITE],
    dit('hors-champ', 'le transparent est resté visible'),
  );
  assert.equal(hors.dessins, 0, dit('hors-champ', 'des dessins ont été émis pour lui'));
  assert.ok(hors.rejetes >= 1, dit('hors-champ', 'le tronc ne l’a pas rejeté'));
  const retour = de('retour');
  assert.ok(retour.rouge[GAUCHE], dit('retour', 'le transparent n’est pas revenu'));
  assert.ok(retour.dessins >= 1, dit('retour', 'aucun dessin de retour'));
  const stables = etapes.filter((e) => e.nom.startsWith('stabilisation-'));
  assert.ok(
    stables.some((e) => e.tenue),
    dit('stabilisation', 'l’image ne s’est jamais tenue : la preuve d’après-tenue serait vide'),
  );
  const apres = de('apres-tenue');
  assert.equal(apres.tenue, false, dit('apres-tenue', 'la tenue n’a pas été cassée'));
  assert.ok(apres.rouge[DROITE], dit('apres-tenue', 'le nouvel emplacement n’est pas montré'));
  assert.ok(!apres.rouge[GAUCHE], dit('apres-tenue', 'l’ancien emplacement est encore peint'));
}
console.log(
  `OK : 2 passes (paginée, non paginée) × 13 images du moteur WebGPU réel — ${resultat.adaptateur}`,
);
