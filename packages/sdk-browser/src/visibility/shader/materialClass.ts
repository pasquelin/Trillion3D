import {
  FLAG_DOUBLE,
  FLAG_HAS_COLOR,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_HAS_UV,
  FLAG_LIT,
  FLAG_MASK,
  FLAG_SAMPLED,
} from '../types.ts'
import { CLASS_FEATURE } from './classWords.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
export type MaterialClassFeature = keyof typeof CLASS_FEATURE
/** Keys addressable: one more bit than the highest feature. */
export const MATERIAL_CLASS_KEYS = 16384

/** Map slots of a row, as `../../webgpu/row/pageRowWriter.ts` resolves them: zero is the absence of a texture. */
type MaterialClassMaps = {
  rough: number
  metal: number
  ao: number
  emissive: number
  normal: number
  /** The surface carries an anisotropic or clear-coat lobe (`hasPhysicalLobes`). */
  physical?: boolean
}

/** Class key of a row: its resolve-relevant flags, and which maps it reads. */
export function materialClassKey(flags: number, maps: MaterialClassMaps) {
  const f = CLASS_FEATURE
  let key = 0
  if (flags & FLAG_HAS_UV) key |= f.HAS_UV
  if (flags & FLAG_HAS_MAP) key |= f.HAS_MAP
  if (flags & FLAG_MASK) key |= f.HAS_MASK
  if (maps.rough) key |= f.HAS_ROUGH
  if (maps.metal) key |= f.HAS_METAL
  if (maps.ao) key |= f.HAS_AO
  if (maps.emissive) key |= f.HAS_EMISSIVE
  if (maps.normal) key |= f.HAS_NORMAL_MAP
  if (flags & FLAG_HAS_NORMAL) key |= f.HAS_VERTEX_NORMAL
  if (flags & FLAG_DOUBLE) key |= f.DOUBLE_SIDED
  if (flags & FLAG_HAS_TANGENT) key |= f.HAS_TANGENT
  if (flags & FLAG_SAMPLED) key |= f.HAS_SAMPLING
  if (flags & FLAG_HAS_COLOR) key |= f.HAS_VERTEX_COLOR
  if (maps.physical && flags & FLAG_LIT) key |= f.HAS_PHYSICAL
  return key
}

/**
 * Pipeline overrides of the resolve: the class key, whether it is the image's only class, and one
 * boolean per feature, each an override expression the backend compiler folds. Without a class
 * — the module compiled alone — every feature is off.
 */
export const MATERIAL_CLASS_WGSL = wgslBlock(
  'MATERIAL_CLASS_WGSL',
  [],
  `override CLASS_KEY:u32=0u;
override SINGLE_CLASS:bool=false;
${Object.entries(CLASS_FEATURE)
  .map(([name, bit]) => `override ${name}:bool=(CLASS_KEY&${bit}u)!=0u;`)
  .join('\n')}
/** A pixel's class key plus one, read off the page table, zero on the background: what the
 *  material tiles (\`materialTilesWgsl.ts\`) list a pixel under. */
fn materialClassOf(id:u32)->u32{
 if(id==0u){return 0u;}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return 0u;}
 return pages[pageIndex].materialClass+1u;
}
/** Whether this pipeline's class resolves the pixel of identifier \`id\`: not the background, a
 *  page of the table, and of the class — the image's only class needs no read of it. Below 256
 *  is the background (0) or an index that wraps past any table, as \`materialClassOf\` finds it.
 *  Every resolve stage asks it before any write: storage writes are not attachments, nothing
 *  else keeps another class's pixels from them. */
fn classAdmits(id:u32)->bool{
 if(id<256u){return false;}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return false;}
 return SINGLE_CLASS||pages[pageIndex].materialClass==CLASS_KEY;
}`,
)
