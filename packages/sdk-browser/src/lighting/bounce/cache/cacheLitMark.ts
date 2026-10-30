import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { LIT_MATERIAL_WGSL } from '../../reflections/hitLighting/pathWgsl.ts'

/** The bit of a ray's mark word that says its hit is to be lit again where it stands (the radiance cache's hit lighting). */
export const CACHE_LIT_MARK = 0x80000000

/** The bits of a mark word after the key of the hit's material (the low fifteen bits, which the sort by material reads): whether the surface faces the ray, whether it is two-sided. */
export const CACHE_LIT_FRONT = 0x8000
export const CACHE_LIT_TWO_SIDED = 0x10000

/** The sides of a mark word (`cacheLitFront`, `cacheLitTwoSided`), which the pass that finishes a lit hit reads back. */
export const CACHE_LIT_MARK_WGSL = wgslBlock(
  'CACHE_LIT_MARK_WGSL',
  [],
  `${wgslConsts({ CACHE_LIT_MARK, CACHE_LIT_FRONT, CACHE_LIT_TWO_SIDED })}
fn cacheLitFront(mark:u32)->bool{return (mark&CACHE_LIT_FRONT)!=0u;}
fn cacheLitTwoSided(mark:u32)->bool{return (mark&CACHE_LIT_TWO_SIDED)!=0u;}`,
)

/**
 * THE MARK OF A HIT OF THE RADIANCE CACHE'S RAYS to light again (`cacheLitMark`), in the stage that casts the rays: the mark bit, the key of the hit's material (`litMaterialKey`) and the sides of the surface, in one word; `probeMark` holds it beside the distance of the hit
 * (the mark texture's two words), zero for a ray that marked nothing.
 */
export const CACHE_LIT_MARKING_WGSL = wgslBlock(
  'CACHE_LIT_MARKING_WGSL',
  [CACHE_LIT_MARK_WGSL, LIT_MATERIAL_WGSL],
  `var<private> probeMark:vec2u=vec2u(0u,0u);
fn cacheLitMark(placement:u32,record:u32,front:bool,twoSided:bool)->u32{
 return CACHE_LIT_MARK|litMaterialKey(placement,record)|select(0u,CACHE_LIT_FRONT,front)|select(0u,CACHE_LIT_TWO_SIDED,twoSided);
}`,
)
