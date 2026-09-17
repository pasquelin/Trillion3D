// Défaut 8 : le matériau dont les six cartes n'ont pas le même mode d'adressage, et la ligne de
// page que le vrai `createPageRowWriter` en écrit. Le banc GPU et le test de non-régression lisent
// tous les deux cette fixture : un seul matériau éprouvé, donc une seule chose à relire quand les
// modes changent.
import * as THREE from 'three';
import { createPageRowWriter } from '../../packages/sdk-browser/webgpuPageRow.ts';
import { PAGE_INFO_STRIDE } from '../../packages/sdk-browser/visibilityTypes.ts';
import { WRAP_MAP } from '../../packages/sdk-browser/visibilityWrapModes.ts';
import { octetsTexture } from './adressageCas.mjs';

const {
  ClampToEdgeWrapping: SERRE,
  RepeatWrapping: REPETE,
  MirroredRepeatWrapping: MIROIR,
} = THREE;

/**
 * Une carte par emplacement du matériau, chacune sur un couple de modes différent : aucun mode n'est
 * partagé par deux cartes voisines, si bien qu'un mot d'adressage appliqué à la mauvaise carte se
 * voit tout de suite. `carte` est le rang de la carte dans le mot, tel que la production le publie.
 */
export const CARTES = [
  { nom: 'base', champ: 'map', carte: WRAP_MAP.base, wrapS: REPETE, wrapT: REPETE },
  { nom: 'rugosité', champ: 'roughnessMap', carte: WRAP_MAP.rough, wrapS: SERRE, wrapT: MIROIR },
  { nom: 'métal', champ: 'metalnessMap', carte: WRAP_MAP.metal, wrapS: MIROIR, wrapT: SERRE },
  { nom: 'normales', champ: 'normalMap', carte: WRAP_MAP.normal, wrapS: SERRE, wrapT: SERRE },
  { nom: 'occlusion', champ: 'aoMap', carte: WRAP_MAP.ao, wrapS: MIROIR, wrapT: MIROIR },
  { nom: 'émissif', champ: 'emissiveMap', carte: WRAP_MAP.emissive, wrapS: REPETE, wrapT: SERRE },
];

/** L'image éprouvée : 4×5 texels tous distincts, celle des bancs d'adressage des lots 4 et 7. */
export const TEXTURE = { largeur: 4, hauteur: 5, octets: Array.from(octetsTexture(4, 5)) };

/**
 * Des coordonnées où les trois modes se séparent : entières, négatives, grandes, et le demi-texel
 * des deux bords d'une période, la couture que le lot 7 a apprise à reboucler. L'axe fixé tombe au
 * centre d'un texel, hors frontière, pour que seule la coordonnée éprouvée décide.
 */
const AXE = [-1001, -2.375, -0.625, 0.375, 0.625, 1.25, 2.625, 1000.625, 0, 0.02, 0.999, 2.98].map(
  Math.fround,
);
export const UV = AXE.flatMap((t) => [
  [t, Math.fround(0.3)],
  [Math.fround(0.375), t],
  [t, t],
]);

/** Le matériau à six cartes, chacune dans son mode, sans image : seuls les modes sont lus ici. */
export function materielMelange() {
  const mat = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  for (const { champ, wrapS, wrapT } of CARTES)
    mat[champ] = Object.assign(new THREE.Texture(), { wrapS, wrapT });
  return mat;
}

/**
 * La ligne de page que la production écrit pour ce matériau : chaque carte occupe sa propre couche
 * d'atlas, si bien qu'aucun index nul ne fait retomber le nuanceur sur un chemin sans texture.
 */
export function ligneDePageMelangee() {
  const mat = materielMelange();
  const attributes = new THREE.BufferGeometry().attributes;
  const mapLayer = new Map([
    [mat.map, 1],
    [mat.emissiveMap, 2],
  ]);
  const dataLayer = new Map([
    [mat.roughnessMap, 1],
    [mat.metalnessMap, 2],
    [mat.normalMap, 3],
    [mat.aoMap, 4],
  ]);
  const echelles = [
    [1, 1],
    [1, 1],
    [1, 1],
    [1, 1],
    [1, 1],
  ];
  const ecrire = createPageRowWriter({
    geometryBlocks: new Map([
      [attributes, { vertexBase: 0, count: 3, hasUv: true, hasNormal: true, hasTangent: false }],
    ]),
    mapLayer,
    dataLayer,
    uvScales: echelles,
    dataUvScales: echelles,
    markRowDirty: () => {},
  });
  const buffer = new ArrayBuffer(PAGE_INFO_STRIDE);
  const floats = new Float32Array(buffer),
    ints = new Uint32Array(buffer);
  const rec = {
    material: mat,
    attributes,
    matrix: new THREE.Matrix4(),
    url: 'défaut8',
    clusterId: 'c0',
    role: 'fine',
    depthLayer: 0,
  };
  ecrire(rec, 0, 0, 0, new Uint32Array([0, 1, 2]), floats, ints);
  return { mat, ints, floats };
}
