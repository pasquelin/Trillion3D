import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAG_MAP_UV_HIGH, FLAG_MAP_UV_LOW, MATERIAL_SECOND_UV } from '../types.ts'
import { QUANTIZED } from './pageGeometryWgsl.ts'
import { normalAtlasWgsl } from './pageWgsl.ts'

/**
 * A page vertex's texture sets past the first, which the maps that ask for one read
 * (`physicalWgsl.ts`): from a quantized page, the sets its header says it stores (`clusterUv`), up
 * to four; from a float geometry, the second set at the tail of the normal atlas, where the row's
 * material word says it has one (`MATERIAL_SECOND_UV`, `vertUv1`), and no other. Declared after
 * `vertUv1`, as `PAGE_NORMAL_WGSL`; a caller reads `pageUvSet` only where `pageHasUvSet` says so.
 */
export const PAGE_UV_SET_WGSL = wgslBlock(
  'PAGE_UV_SET_WGSL',
  [],
  `fn pageHasUvSet(page:PageInfo,h:ClusterHeader,uvSet:u32)->bool{
 if(${QUANTIZED}){return clusterHasUv(h.flags,uvSet);}
 return uvSet==1u&&(page.material&${MATERIAL_SECOND_UV}u)!=0u;
}
fn pageUvSet(page:PageInfo,h:ClusterHeader,vertex:u32,uvSet:u32,end:u32)->vec2f{
 if(${QUANTIZED}){return clusterUv(h,page.pageOffset,vertex,uvSet);}
 return vertUv1(end,page.vertexBase,vertex);
}`,
)

/**
 * The coordinate a row's base map is read at by the cutout and the shadow's transmittance — what
 * every vertex stage hands them (`visWgsl.ts`, `../raster/triWgsl.ts`,
 * `../../lighting/shadows/vsm/render/renderRasterWgsl.ts`, `../../lighting/shadows/vsm/transmission/transmissionRecordWgsl.ts`): the set the base map
 * reads (the row's two flags, `FLAG_MAP_UV_LOW`, glTF's `texCoord`) where the geometry stores it — a quantized
 * page in its header, a float geometry's second set in the normal atlas bound at `binding` —, else the first.
 */
export const maskUvWgsl = (binding: number) =>
  wgslBlock(
    `maskUvWgsl(${binding})`,
    [normalAtlasWgsl(binding), PAGE_UV_SET_WGSL],
    `fn pageMaskUv(page:PageInfo,h:ClusterHeader,vertex:u32)->vec2f{
 let uvSet=select(0u,1u,(page.flags&${FLAG_MAP_UV_LOW}u)!=0u)|select(0u,2u,(page.flags&${FLAG_MAP_UV_HIGH}u)!=0u);
 if(uvSet!=0u&&pageHasUvSet(page,h,uvSet)){return pageUvSet(page,h,vertex,uvSet,normalTexels());}
 return pageUv(page,h,vertex);
}`,
  )
