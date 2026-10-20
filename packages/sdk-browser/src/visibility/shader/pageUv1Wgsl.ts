import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAG_UV1 } from '../../../../sdk-core/src/page/format.ts'
import { FLAG_MAP_UV1, MATERIAL_SECOND_UV } from '../types.ts'
import { QUANTIZED } from './pageGeometryWgsl.ts'
import { normalAtlasWgsl } from './pageWgsl.ts'

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
 if(${QUANTIZED}){return clusterUv1(h,page.pageOffset,vertex);}
 return vertUv1(end,page.vertexBase,vertex);
}`,
)

/**
 * The coordinate a row's base map is read at by the cutout and the shadow's transmittance — what
 * every vertex stage hands them (`visWgsl.ts`, `../../gpu/raster/triWgsl.ts`,
 * `../../vsm/renderRasterWgsl.ts`, `../../vsm/transmissionRecordWgsl.ts`): the second set where the
 * base map reads it (`FLAG_MAP_UV1`, glTF's `texCoord`) and the geometry stores one — a quantized
 * page in its header, a float geometry in the normal atlas bound at `binding` —, else the first.
 */
export const maskUvWgsl = (binding: number) =>
  wgslBlock(
    `maskUvWgsl(${binding})`,
    [normalAtlasWgsl(binding), PAGE_UV1_WGSL],
    `fn pageMaskUv(page:PageInfo,h:ClusterHeader,vertex:u32)->vec2f{
 if((page.flags&${FLAG_MAP_UV1}u)!=0u&&pageHasUv1(page,h)){return pageUv1(page,h,vertex,normalTexels());}
 return pageUv(page,h,vertex);
}`,
  )
