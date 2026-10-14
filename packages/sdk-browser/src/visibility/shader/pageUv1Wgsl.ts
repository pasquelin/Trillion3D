import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAG_UV1 } from '../../../../sdk-core/src/page/format.ts'
import { MATERIAL_SECOND_UV } from '../types.ts'
import { QUANTIZED } from './pageGeometryWgsl.ts'

/**
 * A page vertex's second UV set, which the physical maps that ask for it read (`physicalWgsl.ts`):
 * from a quantized page that stores one (its header's flag), else from the tail of the normal atlas
 * where the row's material word says its float geometry has one (`MATERIAL_SECOND_UV`,
 * `vertUv1`). Declared after `vertUv1`, as `PAGE_NORMAL_WGSL`; a caller reads `pageUv1` only where
 * `pageHasUv1` says so.
 */
export const PAGE_UV1_WGSL = wgslBlock(
  'PAGE_UV1_WGSL',
  [],
  `fn pageHasUv1(page:PageInfo,h:ClusterHeader)->bool{
 if(${QUANTIZED}){return (h.flags&${FLAG_UV1}u)!=0u;}
 return (page.material&${MATERIAL_SECOND_UV}u)!=0u;
}
fn pageUv1(page:PageInfo,h:ClusterHeader,vertex:u32,end:u32)->vec2f{
 if(${QUANTIZED}){
  let base=page.pageOffset;
  return vec2f(clusterGrid(base,h.uv1.x,vertex,h.uv1Bits.x,h.uv1Min.x,h.uv1Step),clusterGrid(base,h.uv1.y,vertex,h.uv1Bits.y,h.uv1Min.y,h.uv1Step));
 }
 return vertUv1(end,page.vertexBase,vertex);
}`,
)
