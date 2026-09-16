import * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { depthLayerBias } from '../sdk-core/index.ts';
import { createPageRowConstants } from './webgpuPageRowConstants.ts';
import {
  assertVisibilityPageTriangles,
  PAGE_INFO_STRIDE,
  VIS_TRIANGLE_BITS,
  FLAG_LIT,
  FLAG_DOUBLE,
  FLAG_HAS_UV,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_MASK,
  FLAG_BACK,
  FLAG_HAS_ORM,
  FLAG_HAS_NORMAL_MAP,
} from './visibilityBuffer.ts';

export const ROW_ID_BASE_WORD = 27,
  ROW_HIZ_SLOT_WORD = 31;
/** Mot où vit l'adressage des cartes de la page, un quartet chacune (`visibilityWrapModes.ts`).
 *  Il occupe un des mots de remplissage de la fiche : la fiche ne grossit pas d'un octet. */
export const ROW_WRAP_MODES_WORD = 61;
/** Mot de la ligne où vit le nombre d'indices que la page dessine : ce que la carte lit pour la
 *  dessiner, et donc le seul compte de sommets qu'un parcours d'image a besoin de relire. */
export const ROW_INDEX_WORDS = 25;
/**
 * Le socle d'identifiant d'une ligne du tableau de pages : son rang décalé des bits du triangle,
 * zéro restant libre pour le fond. La première écriture d'une ligne et le retassage qui la déplace
 * le reposent tous les deux ; deux écritures de la même valeur, une seule formule.
 */
export const packedRowBase = (row: number) => ((row + 1) << VIS_TRIANGLE_BITS) >>> 0;
type GeometryBlock = {
  vertexBase: number;
  count: number;
  hasUv: boolean;
  hasNormal: boolean;
  hasTangent: boolean;
};
type PageRowResources = {
  geometryBlocks: Map<THREE.BufferGeometry['attributes'], GeometryBlock>;
  mapLayer: Map<THREE.Texture, number>;
  dataLayer: Map<THREE.Texture, number>;
  uvScales: Array<[number, number]>;
  dataUvScales: Array<[number, number]>;
  markRowDirty: (row: number) => void;
};

/** Serializes one drawable cluster row after its occupant, slot, or input epoch changes. */
export function createPageRowWriter({
  geometryBlocks,
  mapLayer,
  dataLayer,
  uvScales,
  dataUvScales,
  markRowDirty,
}: PageRowResources) {
  // Ce que le catalogue fixe une fois pour toutes ne se recalcule pas à chaque page qui arrive.
  const constants = createPageRowConstants();
  return (
    rec: PageRec,
    pageIndex: number,
    row: number,
    offsetWords: number,
    index: Uint32Array,
    floats: Float32Array,
    ints: Uint32Array,
  ) => {
    const base = row * (PAGE_INFO_STRIDE / 4),
      material = constants.materialOf(rec.material),
      geo = geometryBlocks.get(rec.attributes);
    const mat = material.mat;
    const layer = mat.map && mapLayer.has(mat.map) ? mapLayer.get(mat.map)! : 0,
      scale = uvScales[layer] ?? [1, 1];
    const roughLayer =
      mat.roughnessMap && dataLayer.has(mat.roughnessMap) ? dataLayer.get(mat.roughnessMap)! : 0;
    const metalLayer =
      mat.metalnessMap && dataLayer.has(mat.metalnessMap) ? dataLayer.get(mat.metalnessMap)! : 0;
    const nrmLayer =
      mat.normalMap && dataLayer.has(mat.normalMap) ? dataLayer.get(mat.normalMap)! : 0;
    floats.set(rec.matrix.elements, base);
    floats[base + 16] = mat.baseColor[0];
    floats[base + 17] = mat.baseColor[1];
    floats[base + 18] = mat.baseColor[2];
    floats[base + 19] = mat.alphaTest > 0 ? mat.alphaTest : 1;
    floats[base + 20] = mat.metalness;
    floats[base + 21] = mat.roughness;
    let flags = 0;
    if (mat.lit) flags |= FLAG_LIT;
    if (mat.doubleSided) flags |= FLAG_DOUBLE;
    if (geo?.hasUv) flags |= FLAG_HAS_UV;
    if (layer) flags |= FLAG_HAS_MAP;
    if (geo?.hasNormal) flags |= FLAG_HAS_NORMAL;
    if (geo?.hasTangent) flags |= FLAG_HAS_TANGENT;
    if (mat.alphaTest > 0) flags |= FLAG_MASK;
    if (mat.backSide) flags |= FLAG_BACK;
    if (roughLayer || metalLayer) flags |= FLAG_HAS_ORM;
    if (nrmLayer) flags |= FLAG_HAS_NORMAL_MAP;
    // A page holding more triangles than the identifier's eight low bits would alias the next page.
    assertVisibilityPageTriangles(index.length / 3, rec.url);
    ints[base + 22] = layer;
    ints[base + 23] = flags;
    ints[base + 24] = offsetWords;
    ints[base + ROW_INDEX_WORDS] = index.length;
    ints[base + 26] = geo?.vertexBase ?? 0;
    ints[base + ROW_ID_BASE_WORD] = packedRowBase(row);
    floats[base + 28] = scale[0];
    floats[base + 29] = scale[1];
    ints[base + 30] = constants.hashOf(rec.clusterId);
    // The Hi-Z verdict of a row lives at the row's own index, and the rows a frame does not test are
    // cleared on the GPU before the test, so no row ever reads the verdict of an earlier image.
    ints[base + ROW_HIZ_SLOT_WORD] = row;
    ints[base + 32] = roughLayer;
    ints[base + 33] = metalLayer;
    ints[base + 34] = nrmLayer;
    floats[base + 35] = mat.normalScale;
    const roughScale = dataUvScales[roughLayer] ?? [1, 1],
      metalScale = dataUvScales[metalLayer] ?? [1, 1],
      nrmScale = dataUvScales[nrmLayer] ?? [1, 1];
    floats[base + 36] = roughScale[0];
    floats[base + 37] = roughScale[1];
    floats[base + 38] = metalScale[0];
    floats[base + 39] = metalScale[1];
    floats[base + 40] = nrmScale[0];
    floats[base + 41] = nrmScale[1];
    const aoLayer = mat.aoMap ? (dataLayer.get(mat.aoMap) ?? 0) : 0,
      emissiveLayer = mat.emissiveMap ? (mapLayer.get(mat.emissiveMap) ?? 0) : 0;
    const aoScale = dataUvScales[aoLayer] ?? [1, 1],
      emissiveScale = uvScales[emissiveLayer] ?? [1, 1];
    ints[base + 42] = aoLayer;
    floats[base + 43] = mat.aoIntensity;
    floats[base + 44] = aoScale[0];
    floats[base + 45] = aoScale[1];
    ints[base + 46] = emissiveLayer;
    ints[base + 47] = pageIndex;
    floats.set(mat.emissive, base + 48);
    floats[base + 52] = emissiveScale[0];
    floats[base + 53] = emissiveScale[1];
    floats[base + 54] = mat.normalScaleY;
    floats[base + 55] = rec.role === 'coarse' ? 1 : 0;
    floats[base + 56] = 0;
    // Unités de profondeur à retrancher pour la couche coplanaire de ce cluster : zéro pour la
    // couche 0, une seule source de calcul pour le chemin matériel comme pour le raster logiciel.
    ints[base + 60] = -depthLayerBias(rec.depthLayer);
    // Chaque carte adresse sa texture dans son propre mode : la couleur peut se répéter là où les
    // normales se serrent, et le nuanceur lit le quartet de la carte qu'il échantillonne.
    ints[base + ROW_WRAP_MODES_WORD] = material.wrap;
    markRowDirty(row);
  };
}
