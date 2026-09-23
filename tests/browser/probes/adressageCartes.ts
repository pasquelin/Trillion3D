// Defect 8: the material whose six maps do not share the same wrap mode, and the page row the
// real `createPageRowWriter` writes for it. The GPU bench and the non-regression test both read
// this fixture: one material exercised, hence one thing to reread when the modes change.
import { importHostTexture } from '../../../packages/sdk-browser/hostSurfaceImport.ts';
import type { Texture } from '../../../packages/sdk-core/index.ts';
import * as THREE from 'three';
import { createPageRowWriter } from '../../../packages/sdk-browser/webgpuPageRow.ts';
import type { PageRec } from '../../../packages/sdk-browser/pageSelection.ts';
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/visibilityTypes.ts';
import { WRAP_MAP } from '../../../packages/sdk-browser/visibilityWrapModes.ts';
import { octetsTexture } from './adressageCas.ts';
import { surfaceOf } from '../../../packages/sdk-browser/pageSurface.ts';

const {
  ClampToEdgeWrapping: SERRE,
  RepeatWrapping: REPETE,
  MirroredRepeatWrapping: MIROIR,
} = THREE;

/** The six texture slots a `MeshStandardMaterial` carries, as the wrap word addresses them. */
type MapChamp = 'map' | 'roughnessMap' | 'metalnessMap' | 'normalMap' | 'aoMap' | 'emissiveMap';

/**
 * One map per material slot, each on a different pair of modes: no mode is shared by two
 * neighbouring maps, so a wrap word applied to the wrong map is seen at once. `carte` is the map's
 * rank in the word, as production publishes it.
 */
export const CARTES: {
  nom: string;
  champ: MapChamp;
  carte: number;
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
}[] = [
  { nom: 'base', champ: 'map', carte: WRAP_MAP.base, wrapS: REPETE, wrapT: REPETE },
  { nom: 'roughness', champ: 'roughnessMap', carte: WRAP_MAP.rough, wrapS: SERRE, wrapT: MIROIR },
  { nom: 'metal', champ: 'metalnessMap', carte: WRAP_MAP.metal, wrapS: MIROIR, wrapT: SERRE },
  { nom: 'normales', champ: 'normalMap', carte: WRAP_MAP.normal, wrapS: SERRE, wrapT: SERRE },
  { nom: 'occlusion', champ: 'aoMap', carte: WRAP_MAP.ao, wrapS: MIROIR, wrapT: MIROIR },
  { nom: 'emissive', champ: 'emissiveMap', carte: WRAP_MAP.emissive, wrapS: REPETE, wrapT: SERRE },
];

/** The exercised image: 4×5 distinct texels, that of the wrap benches of batches 4 and 7. */
export const TEXTURE = { largeur: 4, hauteur: 5, octets: Array.from(octetsTexture(4, 5)) };

/**
 * Coordinates where the three modes part: integers, negatives, large values, and the half-texel
 * of both edges of a period, the seam batch 7 learned to wrap. The fixed axis lands at a texel
 * centre, off the border, so only the exercised coordinate decides.
 */
const AXE = [-1001, -2.375, -0.625, 0.375, 0.625, 1.25, 2.625, 1000.625, 0, 0.02, 0.999, 2.98].map(
  Math.fround,
);
export const UV = AXE.flatMap((t) => [
  [t, Math.fround(0.3)],
  [Math.fround(0.375), t],
  [t, t],
]);

/** The six-map material, each in its mode, with no image: only the modes are read here. */
export function materielMelange() {
  const mat = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  for (const { champ, wrapS, wrapT } of CARTES)
    mat[champ] = Object.assign(new THREE.Texture(), { wrapS, wrapT });
  return mat;
}

/**
 * The page row production writes for this material: each map occupies its own atlas layer, so no
 * null index drops the shader onto a path without a texture.
 */
export function ligneDePageMelangee() {
  const mat = materielMelange();
  const attributes = new THREE.BufferGeometry().attributes;
  // Every slot was just assigned a real Texture by `materielMelange`: the class declares them
  // nullable, this fixture never leaves one unset.
  const mapLayer = new Map<Texture, number>([
    [importHostTexture(mat.map!), 1],
    [importHostTexture(mat.emissiveMap!), 2],
  ]);
  const dataLayer = new Map<Texture, number>([
    [importHostTexture(mat.roughnessMap!), 1],
    [importHostTexture(mat.metalnessMap!), 2],
    [importHostTexture(mat.normalMap!), 3],
    [importHostTexture(mat.aoMap!), 4],
  ]);
  const ecrire = createPageRowWriter({
    geometryBlocks: new Map([
      [attributes, { vertexBase: 0, count: 3, hasUv: true, hasNormal: true, hasTangent: false }],
    ]),
    mapLayer,
    dataLayer,
    markRowDirty: () => {},
  });
  const buffer = new ArrayBuffer(PAGE_INFO_STRIDE);
  const floats = new Float32Array(buffer),
    ints = new Uint32Array(buffer);
  // Only material, attributes, matrix, url and clusterId reach the writer (`webgpuPageRow.ts`);
  // the rest of `PageRec` is filled with placeholders the writer never reads.
  const rec: PageRec = {
    id: 0,
    material: surfaceOf(mat),
    declaration: mat,
    attributes,
    matrix: new THREE.Matrix4(),
    url: 'defect8',
    clusterId: 'c0',
    array: new Uint32Array([0, 1, 2]),
    triangles: 1,
    indexBytes: 12,
    min: [0, 0, 0],
    max: [0, 0, 0],
    depthLayer: 0,
    renderOrder: 0,
    attached: false,
    // A row-written page belongs to a placement: the WebGPU layout sets it.
    placementIndex: 0,
  };
  ecrire(rec, 0, 0, 0, floats, ints);
  return { mat, ints, floats };
}
