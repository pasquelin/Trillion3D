// F20 : les vecteurs de sdk-core. Math.hypot(a, b, c) et validation de scène de transport.
import { length } from '../lightingSceneMath.ts';
import { validateScene } from '../lightingTransportValidation.ts';
import { graine, mesure, stress, rapport } from './mesure.mjs';
import { referenceLength, referenceValidateScene } from './oracles/vecteurs-transport.mjs';

const alea = graine(97);
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

const casLongueur = [
  { nom: '20 000 vecteurs', entree: vecteurs, taille: vecteurs.length },
  { nom: 'hostiles', entree: vecteursHostiles, taille: vecteursHostiles.length },
  { nom: 'aucun vecteur', entree: [], taille: 0 },
];

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

const resLongueur = await mesure({
  nom: 'F20 longueur Vec3',
  fichier: 'packages/sdk-core/lightingSceneMath.ts',
  cas: casLongueur,
  calcul: (liste) => longueurs(liste, length),
  attendu: (liste) => longueurs(liste, referenceLength),
  options: { tours: 100, budgetMs: 1500 },
});

const resScene = await mesure({
  nom: 'F20 normales scène transport',
  fichier: 'packages/sdk-core/lightingTransportValidation.ts',
  cas: [
    { nom: '8 000 facettes', entree: scenes, taille: 8065 },
    { nom: 'aucune scène', entree: [], taille: 0 },
  ],
  calcul: passeScene(validateScene),
  attendu: passeScene(referenceValidateScene),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  nom: 'length extremes',
  calcul: length,
  extremes: [
    { nom: 'NaN', entree: [NaN, 0, 0] },
    { nom: 'Infini', entree: [Infinity, -Infinity, 0] },
    { nom: 'zeros', entree: [-0, 0, -0] },
  ],
});

rapport('f-vecteurs', [resLongueur, resScene], 'F20 rend les mêmes longueurs et refus');
