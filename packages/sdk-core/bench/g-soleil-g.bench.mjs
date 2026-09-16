// G8 : les bornes de cascade du soleil, recalculées à chaque face alors qu'elles ne dépendent que
// de la vue — la même pour les quatre faces d'une image.
import { LIGHT_SETTINGS } from '../sceneLightContracts.ts';
import { sunCascadeOf } from '../sceneLightSunCascades.ts';
import { compare, graine } from './banc.mjs';
import { verifieEtDeposeG } from './bancG.mjs';
import { referenceSunCascadeOf } from './oracles/g-soleil.mjs';

const alea = graine(0x508);
const AXE = [0.3, -0.9, 0.31];

/** Une vue d'ombre : position, direction, ouverture, plans proche et lointain. */
const vue = (near, far, aspect, halfFovY) => ({
  position: [alea() * 20 - 10, alea() * 6, alea() * 20 - 10],
  forward: [0, 0, -1],
  halfFovY,
  aspect,
  near,
  far,
});

/** Nombres hostiles pour les distances de la vue : zéro signé, NaN, infinis, dénormal, limites. */
const HOSTILES = [0, -0, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308, -1];

const images = [];
for (let i = 0; i < 400; i++) images.push(vue(0.05 + alea(), 100 + alea() * 900, 16 / 9, 0.5));
const immobiles = [];
for (let i = 0; i < 400; i++) immobiles.push(vue(0.1, 500, 16 / 9, 0.6));
const hostiles = [];
for (const near of HOSTILES) for (const far of HOSTILES) hostiles.push(vue(near, far, 1, 0.7));

/** Une image : les quatre cascades du soleil, toutes sur la même vue, comme `writeSunFace`. Seuls
 *  les champs que la cascade publie encore : `boxRadius` a quitté `SunCascade` avec le lot des
 *  ombres par pages, le rejet se calculant désormais à partir des demi-côtés de la boîte. */
const faces = (cascadeDe) => (vues) => {
  const sortie = new Float64Array(vues.length * LIGHT_SETTINGS.sunCascades * 7);
  let at = 0;
  for (const view of vues)
    for (let face = 0; face < LIGHT_SETTINGS.sunCascades; face++) {
      const c = cascadeDe(view, AXE, face, 2048);
      sortie[at++] = c.center[0];
      sortie[at++] = c.center[1];
      sortie[at++] = c.center[2];
      sortie[at++] = c.radius;
      sortie[at++] = c.boxCenter[0];
      sortie[at++] = c.boxCenter[1];
      sortie[at++] = c.boxCenter[2];
    }
  return sortie;
};

const lignes = [
  await compare({
    calcul: 'G8 bornes de cascade du soleil',
    fichier: 'packages/sdk-core/sceneLightSunCascades.ts',
    cas: [
      { nom: '400 vues qui bougent, 4 faces chacune', entree: images, taille: 400 },
      { nom: '400 images sur une vue immobile', entree: immobiles, taille: 400 },
      { nom: 'distances hostiles : zéro signé, NaN, infinis', entree: hostiles, taille: 64 },
      { nom: 'une seule vue', entree: [images[0]], taille: 1 },
      { nom: 'aucune vue', entree: [], taille: 0 },
    ],
    reference: faces(referenceSunCascadeOf),
    optimisee: faces(sunCascadeOf),
    options: { tours: 200, budgetMs: 4000, alterne: true },
  }),
];

verifieEtDeposeG(
  'g-soleil',
  'G8 rend les mêmes bornes de cascade, au bit près, pour chaque face',
  lignes,
);
