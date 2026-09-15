// F20 : les vecteurs de sdk-core. `Math.hypot(a, b, c)` à la place d'un étalement, et le produit de
// deux matrices 4×4 écrit à la main dans l'ordre exact de l'accumulateur qu'il remplace.
import { length } from '../../../packages/sdk-core/lightingSceneMath.ts';
import { validateScene } from '../../../packages/sdk-core/lightingTransportValidation.ts';
import { multiply4 } from '../../../packages/sdk-core/sceneLightShadowFaces.ts';
import { compare, graine } from './banc.mjs';
import { verifieEtDeposeF } from './bancF.mjs';
import {
  referenceLength,
  referenceMultiply4,
  referenceValidateScene,
} from './oracles/f-vecteurs.mjs';

const alea = graine(97);
/** Valeurs hostiles : zéro signé, NaN, infinis, dénormal, très grand, très petit. */
const HOSTILES = [0, -0, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308, -1e-300];

const vecteurs = [];
for (let i = 0; i < 20000; i++) vecteurs.push([alea() * 2 - 1, alea() * 1e6 - 5e5, alea() * 1e-8]);
const vecteursHostiles = [];
for (const a of HOSTILES) for (const b of HOSTILES) vecteursHostiles.push([a, b, HOSTILES[0]]);
for (const a of HOSTILES) vecteursHostiles.push([a, a, a]);
vecteursHostiles.push([0, 0, 0], [-0, -0, -0]);

const longueurs = (liste, fn) => {
  const sortie = new Float64Array(liste.length);
  for (let i = 0; i < liste.length; i++) sortie[i] = fn(liste[i]);
  return sortie;
};

/** Paires de matrices : ordinaires, puis remplies de valeurs hostiles, puis les deux mêlées. */
const PAIRES = 4000;
const gauche = new Float32Array(PAIRES * 16),
  droite = new Float32Array(PAIRES * 16);
for (let i = 0; i < PAIRES * 16; i++) {
  gauche[i] = alea() * 4 - 2;
  droite[i] = alea() * 4 - 2;
}
const gaucheHostile = new Float32Array(HOSTILES.length * 16),
  droiteHostile = new Float32Array(HOSTILES.length * 16);
for (let m = 0; m < HOSTILES.length; m++)
  for (let i = 0; i < 16; i++) {
    gaucheHostile[m * 16 + i] = HOSTILES[(m + i) % HOSTILES.length];
    droiteHostile[m * 16 + i] = HOSTILES[(m * 3 + i) % HOSTILES.length];
  }

const produits = (a, b, paires, fn) => {
  const out = new Float32Array(paires * 16),
    scratch = new Float32Array(16);
  for (let m = 0; m < paires; m++) fn(out, m * 16, a, m * 16, b, m * 16, scratch);
  return out;
};
/** Le même tampon en entrée et en sortie : le scratch est ce qui rend l'écriture sur place légale. */
const surPlace = (fn) => {
  const out = gauche.slice(0, 16 * 64),
    scratch = new Float32Array(16);
  for (let m = 0; m < 64; m++) fn(out, m * 16, out, m * 16, droite, m * 16, scratch);
  return out;
};

const casLongueur = [
  { nom: '20 000 vecteurs', entree: vecteurs, taille: vecteurs.length },
  { nom: 'zéros signés, NaN, infinis, dénormaux', entree: vecteursHostiles, taille: 74 },
  { nom: 'aucun vecteur', entree: [], taille: 0 },
];
const casProduit = [
  { nom: '4 000 paires 4×4', entree: { quoi: 'ordinaire' }, taille: PAIRES },
  { nom: 'matrices hostiles', entree: { quoi: 'hostile' }, taille: HOSTILES.length },
  { nom: 'écriture sur place', entree: { quoi: 'surPlace' }, taille: 64 },
  { nom: 'aucune paire', entree: { quoi: 'vide' }, taille: 0 },
];
const passeProduit = (fn) => (entree) => {
  if (entree.quoi === 'ordinaire') return produits(gauche, droite, PAIRES, fn);
  if (entree.quoi === 'hostile') return produits(gaucheHostile, droiteHostile, HOSTILES.length, fn);
  if (entree.quoi === 'surPlace') return surPlace(fn);
  return produits(gauche, droite, 0, fn);
};

/** Une scène de transport : des facettes normalisées, et une dont la normale ne l'est pas. */
const scene = (facettes, cassee) => {
  const patches = [];
  for (let i = 0; i < facettes; i++) {
    const n = [alea() * 2 - 1, alea() * 2 - 1, alea() * 2 - 1];
    const norme = Math.hypot(n[0], n[1], n[2]) || 1;
    const unite = cassee && i === facettes - 1 ? n : [n[0] / norme, n[1] / norme, n[2] / norme];
    patches.push({
      id: i,
      surface: 0,
      center: [alea(), alea(), alea()],
      normal: unite,
      u: [1, 0, 0],
      v: [0, 1, 0],
      albedo: [alea(), alea(), alea()],
      emission: [alea(), 0, 0],
      area: 0.5 + alea(),
    });
  }
  return {
    surfaces: [{ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], columns: facettes, rows: 1 }],
    patches,
  };
};
const scenes = [scene(8000, false), scene(1, false), scene(64, true)];
const passeScene = (fn) => (liste) =>
  liste.map((item) => {
    try {
      fn(item);
      return 'ok';
    } catch (erreur) {
      return erreur.message;
    }
  });

const lignes = [
  await compare({
    calcul: 'F20 longueur d’un Vec3',
    fichier: 'packages/sdk-core/lightingSceneMath.ts',
    cas: casLongueur,
    reference: (liste) => longueurs(liste, referenceLength),
    optimisee: (liste) => longueurs(liste, length),
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'F20 produit de deux matrices 4×4',
    fichier: 'packages/sdk-core/sceneLightShadowFaces.ts',
    cas: casProduit,
    reference: passeProduit(referenceMultiply4),
    optimisee: passeProduit(multiply4),
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'F20 normales d’une scène de transport',
    fichier: 'packages/sdk-core/lightingTransportValidation.ts',
    cas: [
      { nom: '8 000 facettes, 1 facette, normale non unitaire', entree: scenes, taille: 8065 },
      { nom: 'aucune scène', entree: [], taille: 0 },
    ],
    reference: passeScene(referenceValidateScene),
    optimisee: passeScene(validateScene),
    options: { tours: 200, budgetMs: 2500 },
  }),
];

verifieEtDeposeF(
  'f-vecteurs',
  'F20 rend les mêmes longueurs, les mêmes produits de matrices et les mêmes refus',
  lignes,
);
