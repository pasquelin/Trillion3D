// les bornes de cascade du soleil.
import { LIGHT_SETTINGS } from '../sceneLightContracts.ts';
import { sunCascadeOf } from '../sceneLightSunCascades.ts';
import { graine, mesure, stress, rapport } from './socle.mjs';
import { referenceSunCascadeOf } from './oracles/soleil-cascades.mjs';

const alea = graine(0x508);
const AXE = [0.3, -0.9, 0.31];

const vue = (near, far, aspect, halfFovY) => ({
  position: [alea() * 20 - 10, alea() * 6, alea() * 20 - 10],
  forward: [0, 0, -1],
  halfFovY,
  aspect,
  near,
  far,
});

const HOSTILES = [0, -0, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308, -1];
const images = [];
for (let i = 0; i < 400; i++) images.push(vue(0.05 + alea(), 100 + alea() * 900, 16 / 9, 0.5));
const immobiles = [];
for (let i = 0; i < 400; i++) immobiles.push(vue(0.1, 500, 16 / 9, 0.6));
const hostiles = [];
for (const near of HOSTILES) for (const far of HOSTILES) hostiles.push(vue(near, far, 1, 0.7));

const faces = (cascadeDe) => (vues) => {
  const sortie = new Float64Array(vues.length * LIGHT_SETTINGS.sunCascades * 7);
  let at = 0;
  for (const view of vues) {
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
  }
  return sortie;
};

const cas = [
  { nom: '400 vues qui bougent', entree: images, taille: 400 },
  { nom: '400 images vue immobile', entree: immobiles, taille: 400 },
  { nom: 'distances hostiles', entree: hostiles, taille: hostiles.length },
  { nom: 'une seule vue', entree: [images[0]], taille: 1 },
  { nom: 'aucune vue', entree: [], taille: 0 },
];

const res = await mesure({
  nom: 'bornes cascade soleil',
  fichier: 'packages/sdk-core/sceneLightSunCascades.ts',
  cas,
  calcul: faces(sunCascadeOf),
  attendu: faces(referenceSunCascadeOf),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  nom: 'sunCascadeOf extremes',
  calcul: (v) => sunCascadeOf(v, AXE, 0, 2048),
  extremes: [
    { nom: 'near=far', entree: vue(10, 10, 1, 0.5) },
    { nom: 'near negatif', entree: vue(-5, 50, 1, 0.5) },
    { nom: 'fov infini', entree: vue(0.1, 100, 1, Infinity) },
  ],
});

rapport('soleil-cascades', [res], 'G8 rend exactement les mêmes bornes de cascade');
