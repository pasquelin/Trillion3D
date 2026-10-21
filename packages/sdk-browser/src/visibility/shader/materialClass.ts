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
  FLAG_VOXEL,
} from '../types.ts'
import { CLASS_FEATURE } from './classWords.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { visPageIndex, visRowIn } from '../visWords.ts'
export type MaterialClassFeature = keyof typeof CLASS_FEATURE
/** Keys addressable: one more bit than the highest feature. */
export const MATERIAL_CLASS_KEYS = 32768

/** Map slots of a row, as `../../geometry/rows/page/pageRowWriter.ts` resolves them: zero is the absence of a texture. */
type MaterialClassMaps = {
  rough: number
  metal: number
  ao: number
  emissive: number
  normal: number
  /** The surface carries an anisotropic or clear-coat lobe (`hasPhysicalLobes`). */
  physical?: boolean
}

/** Class key of a row: its resolve-relevant flags, which maps it reads, and whether one of them
 *  reads a second UV set its geometry has (`secondUv`). */
export function materialClassKey(flags: number, maps: MaterialClassMaps, secondUv = false) {
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
  // The physical path holds the second UV set's decode too: a class that reads neither a lobe
  // nor that set compiles none of it.
  if ((maps.physical && flags & FLAG_LIT) || secondUv) key |= f.HAS_PHYSICAL
  if (flags & FLAG_VOXEL) key |= f.VOXEL
  return key
}

/**
 * Pipeline overrides of the resolve: the class key and one boolean per feature, each an override
 * expression the backend compiler folds. Without a class — the module compiled alone — every
 * feature is off.
 */
export const MATERIAL_CLASS_WGSL = wgslBlock(
  'MATERIAL_CLASS_WGSL',
  [],
  `override CLASS_KEY:u32=0u;
${Object.entries(CLASS_FEATURE)
  .map(([name, bit]) => `override ${name}:bool=(CLASS_KEY&${bit}u)!=0u;`)
  .join('\n')}`,
)

/** A pixel's class key plus one, read off the page table (`pages`, the host's, and its uniform's
 *  `pageCount`), zero on the background and past the table (`visRowIn`): what the shading bins
 *  sort a pixel by (`shadeBinsWgsl.ts`). */
export const MATERIAL_CLASS_OF_WGSL = wgslBlock(
  'MATERIAL_CLASS_OF_WGSL',
  [visPageIndex, visRowIn],
  `fn materialClassOf(id:u32)->u32{
 if(!visRowIn(id,uni.pageCount)){return 0u;}
 return pages[visPageIndex(id)].materialClass+1u;
}`,
)
