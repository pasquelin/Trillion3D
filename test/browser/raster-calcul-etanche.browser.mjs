// Preuve par le moteur réel : le raster de calcul (variante `raster-calcul`) rend la même image
// que le raster matériel, à la silhouette près. Douze carreaux inclinés, chacun deux triangles qui
// partagent une diagonale dans deux clusters distincts, un carreau de face dont la diagonale à 45°
// passe par le centre des pixels, un carreau immense dont la diagonale traverse
// l'image depuis des sommets à des milliers de pixels hors champ, et un carreau qui traverse le plan
// proche.
//
// Avant le correctif, la couverture se décidait sur des poids barycentriques dérivés : sur une
// arête partagée, les deux voisins laissaient le même pixel à personne (fissure) et sur un éclat
// de la coupe au plan proche l'arrondi acceptait des pixels loin du triangle (frise). Le banc
// `.mesure/out/l26-2-quart` en avait chiffré 2 796 px sur Emerald. Ici : zéro pixel intérieur.
//
//   node --experimental-strip-types test/browser/raster-calcul-etanche.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'rasterCalculPage.mjs',
  'rasterCalcul',
  'Raster de calcul étanche',
);
console.log(
  JSON.stringify(
    {
      adaptateur: resultat.adaptateur ?? null,
      couverts: resultat.couverts,
      clusters: resultat.clusters,
      variantes: resultat.variantes,
      erreurs: resultat.erreurs,
    },
    null,
    2,
  ),
);
preuveSaine(resultat);
assert.ok(resultat.couverts > 1000, `la scène ne couvre que ${resultat.couverts} pixels`);
assert.equal(resultat.clusters, 30);
for (const [variante, releve] of Object.entries(resultat.variantes)) {
  assert.equal(releve.clusters, 30, `${variante} : les deux moteurs dessinent la même coupe`);
  assert.deepEqual(
    releve.interieurs,
    [],
    `${variante} : ${releve.interieurs.length / 2} pixel(s) diffèrent loin de toute silhouette — fissure, triangle parasite, ou triangle qu'aucun des deux rasters n'a pris`,
  );
  // La silhouette peut différer d'un pixel là où les deux règles de remplissage ne coïncident pas ;
  // elle ne peut pas différer plus que son propre périmètre.
  assert.ok(
    releve.silhouettes < resultat.couverts / 8,
    `${variante} : ${releve.silhouettes} pixels de silhouette diffèrent sur ${resultat.couverts} couverts`,
  );
}
const silhouettes = Object.values(resultat.variantes).map((releve) => releve.silhouettes);
console.log(
  `OK : ${resultat.couverts} pixels couverts, 0 différence intérieure sous les deux variantes, silhouettes ${silhouettes.join(' / ')} — ${resultat.adaptateur}`,
);
