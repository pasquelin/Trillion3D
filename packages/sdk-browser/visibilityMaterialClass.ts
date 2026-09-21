import {
  FLAG_DOUBLE,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_HAS_UV,
  FLAG_MASK,
} from './visibilityTypes.ts';

/**
 * Material classes of the surface resolve, the published visibility-buffer design: the resolve
 * no longer branches per pixel on what a material has, it runs one draw per class through the
 * hardware depth test. A class is the set of features the shader would otherwise test at run
 * time — its key is a word of feature bits, and every page of a class carries the same bits.
 *
 * The material-depth pass writes each pixel's class as a depth (`materialClassDepth`); each class
 * pass then draws a full-screen triangle at that same depth under `depthCompare: 'equal'`, so the
 * fragment stage of a class runs on its pixels only, compiled with the class's feature bits as
 * pipeline overrides. Every value written is exact in `f32`: a class never misses its pixels.
 */
export const CLASS_FEATURE = {
  HAS_UV: 1,
  HAS_MAP: 2,
  HAS_MASK: 4,
  HAS_ROUGH: 8,
  HAS_METAL: 16,
  HAS_AO: 32,
  HAS_EMISSIVE: 64,
  HAS_NORMAL_MAP: 128,
  HAS_VERTEX_NORMAL: 256,
  DOUBLE_SIDED: 512,
  HAS_TANGENT: 1024,
} as const;
export type MaterialClassFeature = keyof typeof CLASS_FEATURE;
/** Keys addressable: one more bit than the highest feature; key + 1 stays exact as a depth. */
export const MATERIAL_CLASS_KEYS = 2048;
/** Depth denominator: a power of two, so every class depth `(key + 1) / units` is exact in `f32`. */
export const CLASS_DEPTH_UNITS = 4096;
/** Format of the material-depth target: exact for every class depth, like the opaque depth. */
export const MATERIAL_DEPTH_FORMAT: GPUTextureFormat = 'depth32float';

/** Map slots of a row, as `webgpuPageRow.ts` resolves them: zero is the absence of a texture. */
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
  return key;
}

/**
 * Pipeline overrides of the resolve: the class key, the depth its triangle is drawn at, and one
 * boolean per feature, each an override expression the backend compiler folds. Without a class
 * — the module compiled alone — every feature is off.
 */
export const MATERIAL_CLASS_WGSL = `override CLASS_KEY:u32=0u;
override CLASS_DEPTH:f32=f32(CLASS_KEY+1u)/${CLASS_DEPTH_UNITS}.0;
${Object.entries(CLASS_FEATURE)
  .map(([name, bit]) => `override ${name}:bool=(CLASS_KEY&${bit}u)!=0u;`)
  .join('\n')}
/** Depth of a pixel's class, read off the page table, zero on the background: what each class
 *  pass tests against. */
fn materialClassDepth(id:u32)->f32{
 if(id==0u){return 0.0;}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return 0.0;}
 return f32(pages[pageIndex].materialClass+1u)/${CLASS_DEPTH_UNITS}.0;
}`;
