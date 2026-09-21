// Benchmark for batch 4: shading normal.
import * as THREE from 'three';
import { shadingNormal } from '../visibilityShadingNormal.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import { referenceShadingNormal } from './oracles/normale-ombrage.ts';
import { reperes } from './appui/scenesNormale.ts';

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
  const output = new Float64Array(items.length * 3);
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const n = normale(p.page, p.tri, p.bary, p.uv, p.mat, p.screenFace);
    output[i * 3] = lit(n, 0);
    output[i * 3 + 1] = lit(n, 1);
    output[i * 3 + 2] = lit(n, 2);
  }
  return output;
};

const res = await mesure({
  name: 'shadingNormal hostile frames',
  fichier: 'packages/sdk-browser/visibilityShadingNormal.ts',
  cas: [
    { name: `${lot.length} hostile frames`, input: lot, size: lot.length },
    { name: 'one frame', input: lot.slice(0, 1), size: 1 },
    { name: 'no frame', input: [], size: 0 },
  ],
  calcul: passe(shadingNormal, (n, c) => n[c]),
  attendu: passe(referenceShadingNormal, (n, c) => (c === 0 ? n.x : c === 1 ? n.y : n.z)),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'shadingNormal extremes',
  calcul: (p) => shadingNormal(p.page, p.tri, p.bary, p.uv, p.mat, p.screenFace),
  extremes: [
    { name: 'first', input: lot[0] },
    { name: 'last', input: lot[lot.length - 1] },
  ],
});

rapport('normale-ombrage', [res], 'shadingNormal returns exact same components');
