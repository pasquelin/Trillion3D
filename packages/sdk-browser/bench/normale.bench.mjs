// Banc du lot 4 « normale d'ombrage » : le repère tangent du raster témoin, sorti de la bibliothèque
// hôte. L'oracle `oracles/normale.mjs` est le fichier d'avant, avec ses `Vector3` et sa `Matrix3` ;
// le code mesuré est `visibilityShadingNormal.ts`, sur les vecteurs plats du socle.
//
// Même règle que les autres lots de calcul : une seule composante différente au sens d'`Object.is`
// — le zéro signé et le NaN compris — et la ligne tombe. Les repères sont choisis hostiles :
// normales dégénérées et nulles, échelles négatives et non uniformes, cisaillement, matrice
// singulière, NaN, ±0 et infinis dans les attributs comme dans les poids barycentriques.
//
// La colonne de performance est relevée ici pour mémoire ; elle ne vaut que sur machine calme.
import * as THREE from 'three';
import { shadingNormal } from '../visibilityShadingNormal.ts';
import { compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { referenceShadingNormal } from './oracles/normale.mjs';
import { reperes } from './scenesNormale.mjs';

const alea = graine(0x4e07);

/** Une texture RGBA de 8×8 tirée de la graine : la carte de normales du repère tangent. */
function carteNormales(depart) {
  const data = new Uint8Array(8 * 8 * 4),
    tire = graine(depart);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(tire() * 256) & 255;
  const map = new THREE.Texture();
  map.image = { data, width: 8, height: 8 };
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

const CARTE = carteNormales(0x51);

/** Les matières à croiser avec les repères : avec et sans carte, deux faces, face arrière. */
const matieres = [
  { carte: false, doubleSided: false, backSide: false, normalScale: 1, normalScaleY: 1 },
  { carte: true, doubleSided: false, backSide: false, normalScale: 1.25, normalScaleY: -0.75 },
  { carte: true, doubleSided: true, backSide: false, normalScale: -2, normalScaleY: 0 },
  { carte: true, doubleSided: true, backSide: true, normalScale: 0, normalScaleY: 1e308 },
  { carte: true, doubleSided: false, backSide: true, normalScale: -0, normalScaleY: -0 },
].map((m) => ({
  baseColor: [0.8, 0.6, 0.4],
  metalness: 0.3,
  roughness: 0.4,
  lit: true,
  doubleSided: m.doubleSided,
  backSide: m.backSide,
  alphaTest: 0,
  normalMap: m.carte ? CARTE : undefined,
  normalScale: m.normalScale,
  normalScaleY: m.normalScaleY,
  aoIntensity: 1,
  emissive: [0, 0, 0],
  transmission: 0,
}));

/** Le lot complet : chaque repère hostile × chaque matière × les deux signes d'aire écran. */
function cas() {
  const lot = [];
  for (const repere of reperes())
    for (const mat of matieres)
      for (const screenFace of [1, -1])
        lot.push({
          page: repere.page,
          tri: repere.tri,
          bary: repere.bary,
          uv: [alea() * 3 - 1, alea() * 3 - 1],
          mat,
          screenFace,
        });
  return lot;
}

/** Un tour : chaque repère du lot, les trois composantes écrites bout à bout. */
const passe = (normale, lit) => (lot) => {
  const sortie = new Float64Array(lot.length * 3);
  for (let i = 0; i < lot.length; i++) {
    const p = lot[i];
    const n = normale(p.page, p.tri, p.bary, p.uv, p.mat, p.screenFace);
    sortie[i * 3] = lit(n, 0);
    sortie[i * 3 + 1] = lit(n, 1);
    sortie[i * 3 + 2] = lit(n, 2);
  }
  return sortie;
};

const lot = cas();
const lignes = [
  await compare({
    calcul: 'lot 4 repère tangent et normale d’ombrage',
    fichier: 'packages/sdk-browser/visibilityShadingNormal.ts',
    cas: [
      { nom: `${lot.length} repères hostiles × matières × faces`, entree: lot, taille: lot.length },
      { nom: 'un seul repère', entree: lot.slice(0, 1), taille: 1 },
      { nom: 'aucun repère', entree: [], taille: 0 },
    ],
    reference: passe(referenceShadingNormal, (n, c) => (c === 0 ? n.x : c === 1 ? n.y : n.z)),
    optimisee: passe(shadingNormal, (n, c) => n[c]),
    options: { tours: 200, budgetMs: 4000, alterne: true },
  }),
];

verifieEtDepose(
  'normale',
  'le repère tangent du raster témoin rend les mêmes trois composantes, au bit près',
  lignes,
);
