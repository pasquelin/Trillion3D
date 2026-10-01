import {
  FLAG_DOUBLE,
  FLAG_HAS_COLOR,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_HAS_UV,
  FLAG_MASK,
  FLAG_SAMPLED,
} from '../types.ts';
import { CLASS_FEATURE, CLASS_DEPTH_UNITS } from './classWords.ts';
export type MaterialClassFeature = keyof typeof CLASS_FEATURE;
/** Keys addressable: one more bit than the highest feature; key + 1 stays exact as a depth. */
export const MATERIAL_CLASS_KEYS = 8192;
/** Format of the material-depth target: exact for every class depth, like the opaque depth. */
export const MATERIAL_DEPTH_FORMAT: GPUTextureFormat = 'depth32float';

/** Map slots of a row, as `../../webgpu/row/pageRow.ts` resolves them: zero is the absence of a texture. */
export type MaterialClassMaps = {
  rough: number;
  metal: number;
  ao: number;
  emissive: number;
  normal: number;
};

/** Class key of a row: its resolve-relevant flags, and which maps it reads. */
export function materialClassKey(flags: number, maps: MaterialClassMaps) {
  const f = CLASS_FEATURE;
  let key = 0;
  if (flags & FLAG_HAS_UV) key |= f.HAS_UV;
  if (flags & FLAG_HAS_MAP) key |= f.HAS_MAP;
  if (flags & FLAG_MASK) key |= f.HAS_MASK;
  if (maps.rough) key |= f.HAS_ROUGH;
  if (maps.metal) key |= f.HAS_METAL;
  if (maps.ao) key |= f.HAS_AO;
  if (maps.emissive) key |= f.HAS_EMISSIVE;
  if (maps.normal) key |= f.HAS_NORMAL_MAP;
  if (flags & FLAG_HAS_NORMAL) key |= f.HAS_VERTEX_NORMAL;
  if (flags & FLAG_DOUBLE) key |= f.DOUBLE_SIDED;
  if (flags & FLAG_HAS_TANGENT) key |= f.HAS_TANGENT;
  if (flags & FLAG_SAMPLED) key |= f.HAS_SAMPLING;
  if (flags & FLAG_HAS_COLOR) key |= f.HAS_VERTEX_COLOR;
  return key;
}

/**
 * Pipeline overrides of the resolve: the class key, the depth its triangle is drawn at, and one
 * boolean per feature, each an override expression the backend compiler folds. Without a class
 * — the module compiled alone — every feature is off.
 */
export const MATERIAL_CLASS_WGSL = `override CLASS_KEY:u32=0u;
override SINGLE_CLASS:bool=false;
override CLASS_DEPTH:f32=f32(CLASS_KEY+1u)/${CLASS_DEPTH_UNITS}.0;
${Object.entries(CLASS_FEATURE)
  .map(([name, bit]) => `override ${name}:bool=(CLASS_KEY&${bit}u)!=0u;`)
  .join('\n')}
/** A pixel's class key plus one, read off the page table, zero on the background: the one
 *  answer the material depth and the material tiles (\`materialTilesWgsl.ts\`) share. */
fn materialClassOf(id:u32)->u32{
 if(id==0u){return 0u;}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return 0u;}
 return pages[pageIndex].materialClass+1u;
}
/** Depth of a pixel's class, zero on the background: what each class pass tests against. */
fn materialClassDepth(id:u32)->f32{return f32(materialClassOf(id))/${CLASS_DEPTH_UNITS}.0;}`;
