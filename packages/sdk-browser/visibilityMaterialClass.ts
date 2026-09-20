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
export const CLASS_UV = 1,
  CLASS_MAP = 2,
  CLASS_MASK = 4,
  CLASS_ROUGH = 8,
  CLASS_METAL = 16,
  CLASS_AO = 32,
  CLASS_EMISSIVE = 64,
  CLASS_NORMAL_MAP = 128,
  CLASS_VERTEX_NORMAL = 256,
  CLASS_DOUBLE = 512,
  CLASS_TANGENT = 1024;
/** Keys addressable: one more bit than the highest feature; key + 1 stays exact as a depth. */
export const MATERIAL_CLASS_KEYS = 2048;
/** Depth denominator: a power of two, so every class depth is exact in `f32`. */
const CLASS_DEPTH_UNITS = 4096;
/** Format of the material-depth target: exact for every class depth, like the opaque depth. */
export const MATERIAL_DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
/** Row word of the page table that carries the class key (`PageInfo.materialClass`). */
export const ROW_MATERIAL_CLASS_WORD = 63;

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
  let key = 0;
  if (flags & FLAG_HAS_UV) key |= CLASS_UV;
  if (flags & FLAG_HAS_MAP) key |= CLASS_MAP;
  if (flags & FLAG_MASK) key |= CLASS_MASK;
  if (maps.rough) key |= CLASS_ROUGH;
  if (maps.metal) key |= CLASS_METAL;
  if (maps.ao) key |= CLASS_AO;
  if (maps.emissive) key |= CLASS_EMISSIVE;
  if (maps.normal) key |= CLASS_NORMAL_MAP;
  if (flags & FLAG_HAS_NORMAL) key |= CLASS_VERTEX_NORMAL;
  if (flags & FLAG_DOUBLE) key |= CLASS_DOUBLE;
  if (flags & FLAG_HAS_TANGENT) key |= CLASS_TANGENT;
  return key;
}

/** Depth of a class's pixels in the material-depth target; the background stays at zero. */
export const materialClassDepth = (key: number) => (key + 1) / CLASS_DEPTH_UNITS;

/** Override name of each feature bit, as the resolve shader tests it. */
const FEATURES = {
  HAS_UV: CLASS_UV,
  HAS_MAP: CLASS_MAP,
  HAS_MASK: CLASS_MASK,
  HAS_ROUGH: CLASS_ROUGH,
  HAS_METAL: CLASS_METAL,
  HAS_AO: CLASS_AO,
  HAS_EMISSIVE: CLASS_EMISSIVE,
  HAS_NORMAL_MAP: CLASS_NORMAL_MAP,
  HAS_VERTEX_NORMAL: CLASS_VERTEX_NORMAL,
  DOUBLE_SIDED: CLASS_DOUBLE,
  HAS_TANGENT: CLASS_TANGENT,
} as const;
export type MaterialClassFeature = keyof typeof FEATURES;

/**
 * Pipeline overrides of the resolve: the class key, the depth its triangle is drawn at, and one
 * boolean per feature, each an override expression the backend compiler folds. Without a class
 * — the module compiled alone — every feature is off.
 */
export const MATERIAL_CLASS_WGSL = `override CLASS_KEY:u32=0u;
override CLASS_DEPTH:f32=f32(CLASS_KEY+1u)/${CLASS_DEPTH_UNITS}.0;
${Object.entries(FEATURES)
  .map(([name, bit]) => `override ${name}:bool=(CLASS_KEY&${bit}u)!=0u;`)
  .join('\n')}
/** Depth of a pixel's class, read off the page table: what each class pass tests against. */
fn materialClassDepth(id:u32)->f32{
 if(id==0u){return 0.0;}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return 0.0;}
 return f32(pages[pageIndex].materialClass+1u)/${CLASS_DEPTH_UNITS}.0;
}`;

/** Constants a class pipeline is created with: the key alone, the rest derives in the shader. */
export const materialClassConstants = (key: number) => ({ CLASS_KEY: key });
