import { visMaterial } from './visibilityBuffer.ts';
import type * as THREE from 'three';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/**
 * La fiche d'un item transparent : tout ce qu'un appel de mélange lit sur LUI, et rien de ce qui
 * dépend de l'image.
 *
 * Ces mots ne bougent que si la scène bouge — une matrice déplacée, un matériau réécrit. Une caméra
 * qui tourne n'en change aucun. C'est ce qui permet de les ranger dans un tampon de stockage indexé
 * par le rang de l'item au lieu d'un uniforme à décalage dynamique : plus rien à écrire par image,
 * et plus un groupe de liaison par appel.
 */
export const BLEND_ITEM_WORDS = 44;

/** Les tables d'atlas que la fiche cite : la couche de chaque texture et l'échelle de chaque couche. */
export type BlendAtlasTables = {
  mapLayer: Map<THREE.Texture, number>;
  dataLayer: Map<THREE.Texture, number>;
  uvScales: Array<[number, number]>;
};

/** Écrit la fiche d'un item à son rang. `floats` et `ints` sont deux vues du même tampon. */
export function writeBlendItemRecord(
  floats: Float32Array,
  ints: Uint32Array,
  index: number,
  item: BlendGpuItem,
  tables: BlendAtlasTables,
) {
  const base = index * BLEND_ITEM_WORDS,
    mat = visMaterial(item.material);
  const layer = item.map && tables.mapLayer.has(item.map) ? tables.mapLayer.get(item.map)! : 0,
    scale = tables.uvScales[layer] ?? [1, 1];
  floats.set(item.matrix.elements, base);
  floats[base + 16] = item.rgba[0];
  floats[base + 17] = item.rgba[1];
  floats[base + 18] = item.rgba[2];
  floats[base + 19] = item.rgba[3];
  // Où l'instance lit ce qu'elle dessine, elle le tient de la liste étalée ; la fiche ne porte plus
  // que ce qui appartient à l'item — ses indices, son premier sommet, ses drapeaux, ses cartes.
  ints[base + 20] = item.count;
  ints[base + 21] = item.vertexBase ?? 0;
  ints[base + 22] = item.flags;
  ints[base + 23] = layer;
  ints[base + 24] = mat.emissiveMap ? (tables.mapLayer.get(mat.emissiveMap) ?? 0) : 0;
  ints[base + 25] = item.wrapModes;
  ints[base + 26] = 0;
  ints[base + 27] = 0;
  floats[base + 28] = scale[0];
  floats[base + 29] = scale[1];
  floats[base + 30] = mat.alphaTest;
  floats[base + 31] = mat.aoIntensity;
  floats[base + 32] = mat.roughness;
  floats[base + 33] = mat.metalness;
  floats[base + 34] = mat.normalScale;
  floats[base + 35] = mat.normalScaleY;
  ints[base + 36] = mat.roughnessMap ? (tables.dataLayer.get(mat.roughnessMap) ?? 0) : 0;
  ints[base + 37] = mat.metalnessMap ? (tables.dataLayer.get(mat.metalnessMap) ?? 0) : 0;
  ints[base + 38] = mat.normalMap ? (tables.dataLayer.get(mat.normalMap) ?? 0) : 0;
  ints[base + 39] = mat.aoMap ? (tables.dataLayer.get(mat.aoMap) ?? 0) : 0;
  floats[base + 40] = mat.emissive[0];
  floats[base + 41] = mat.emissive[1];
  floats[base + 42] = mat.emissive[2];
  floats[base + 43] = 0;
}

/** La déclaration WGSL de la fiche, écrite une fois pour le nuanceur et pour la disposition. */
export const BLEND_ITEM_WGSL = `struct BlendItem{world:mat4x4f,color:vec4f,indexCount:u32,vertexBase:u32,flags:u32,mapIndex:u32,emissiveIndex:u32,wrapModes:u32,padItem0:u32,padItem1:u32,uvScale:vec2f,alphaTest:f32,aoIntensity:f32,roughness:f32,metalness:f32,normalScale:vec2f,roughIndex:u32,metalIndex:u32,normalIndex:u32,aoIndex:u32,emissive:vec4f,}`;
