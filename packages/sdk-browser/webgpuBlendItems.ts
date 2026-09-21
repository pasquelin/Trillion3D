import type { HostTexture } from './hostResources.ts';
import { visMaterial } from './visibilityBuffer.ts';
import type * as THREE from 'three';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/**
 * Record of a transparent item: everything a blend draw reads about IT, and nothing that
 * depends on the frame.
 *
 * These words move only if the scene moves — a matrix shifted, a material rewritten. A camera
 * that turns changes none of them. That is why they live in a storage buffer indexed by item
 * rank instead of a dynamically offset uniform: nothing left to write per frame, and no bind
 * group per draw.
 */
export const BLEND_ITEM_WORDS = 40;

/** Atlas tables the record cites: each texture's slot, per atlas. */
export type BlendAtlasTables = {
  mapLayer: Map<HostTexture, number>;
  dataLayer: Map<HostTexture, number>;
};

/** Writes an item's record at its rank. `floats` and `ints` are two views of the same buffer. */
export function writeBlendItemRecord(
  floats: Float32Array,
  ints: Uint32Array,
  index: number,
  item: BlendGpuItem,
  tables: BlendAtlasTables,
) {
  const base = index * BLEND_ITEM_WORDS,
    mat = visMaterial(item.material);
  const layer = item.map && tables.mapLayer.has(item.map) ? tables.mapLayer.get(item.map)! : 0;
  floats.set(item.matrix.elements, base);
  floats[base + 16] = item.rgba[0];
  floats[base + 17] = item.rgba[1];
  floats[base + 18] = item.rgba[2];
  floats[base + 19] = item.rgba[3];
  // Where the instance reads what it draws, it takes it from the expanded list; the record now
  // carries only what belongs to the item — its indices, first vertex, flags, maps.
  ints[base + 20] = item.count;
  ints[base + 21] = item.vertexBase ?? 0;
  ints[base + 22] = item.flags;
  ints[base + 23] = layer;
  ints[base + 24] = mat.emissiveMap ? (tables.mapLayer.get(mat.emissiveMap) ?? 0) : 0;
  ints[base + 25] = item.wrapModes;
  floats[base + 26] = mat.alphaTest;
  floats[base + 27] = mat.aoIntensity;
  floats[base + 28] = mat.roughness;
  floats[base + 29] = mat.metalness;
  floats[base + 30] = mat.normalScale;
  floats[base + 31] = mat.normalScaleY;
  ints[base + 32] = mat.roughnessMap ? (tables.dataLayer.get(mat.roughnessMap) ?? 0) : 0;
  ints[base + 33] = mat.metalnessMap ? (tables.dataLayer.get(mat.metalnessMap) ?? 0) : 0;
  ints[base + 34] = mat.normalMap ? (tables.dataLayer.get(mat.normalMap) ?? 0) : 0;
  ints[base + 35] = mat.aoMap ? (tables.dataLayer.get(mat.aoMap) ?? 0) : 0;
  floats[base + 36] = mat.emissive[0];
  floats[base + 37] = mat.emissive[1];
  floats[base + 38] = mat.emissive[2];
  floats[base + 39] = 0;
}

/** WGSL declaration of the record, written once for the shader and for the layout. */
export const BLEND_ITEM_WGSL = `struct BlendItem{world:mat4x4f,color:vec4f,indexCount:u32,vertexBase:u32,flags:u32,mapIndex:u32,emissiveIndex:u32,wrapModes:u32,alphaTest:f32,aoIntensity:f32,roughness:f32,metalness:f32,normalScale:vec2f,roughIndex:u32,metalIndex:u32,normalIndex:u32,aoIndex:u32,emissive:vec4f,}`;
