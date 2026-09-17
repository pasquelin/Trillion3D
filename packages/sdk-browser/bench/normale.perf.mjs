// Banc du lot 4 : normale d'ombrage.
import * as THREE from 'three';
import { shadingNormal } from '../visibilityShadingNormal.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { referenceShadingNormal } from './oracles/normale.mjs';
import { reperes } from './scenesNormale.mjs';

const alea = graine(0x4e07);

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

function preparerLot() {
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

const lot = preparerLot();
const passe = (normale, lit) => (items) => {
  const sortie = new Float64Array(items.length * 3);
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const n = normale(p.page, p.tri, p.bary, p.uv, p.mat, p.screenFace);
    sortie[i * 3] = lit(n, 0);
    sortie[i * 3 + 1] = lit(n, 1);
    sortie[i * 3 + 2] = lit(n, 2);
  }
  return sortie;
};

const res = await mesure({
  nom: 'shadingNormal repères hostiles',
  fichier: 'packages/sdk-browser/visibilityShadingNormal.ts',
  cas: [
    { nom: `${lot.length} repères hostiles`, entree: lot, taille: lot.length },
    { nom: 'un repère', entree: lot.slice(0, 1), taille: 1 },
    { nom: 'aucun repère', entree: [], taille: 0 },
  ],
  calcul: passe(shadingNormal, (n, c) => n[c]),
  attendu: passe(referenceShadingNormal, (n, c) => (c === 0 ? n.x : c === 1 ? n.y : n.z)),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  nom: 'shadingNormal extremes',
  calcul: (p) => shadingNormal(p.page, p.tri, p.bary, p.uv, p.mat, p.screenFace),
  extremes: [
    { nom: 'premier', entree: lot[0] },
    { nom: 'dernier', entree: lot[lot.length - 1] },
  ],
});

rapport('normale', [res], 'shadingNormal rend exactement les mêmes composantes');
