import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { MAP_UV_SET } from '../mapUvSet.ts'
import { MATERIAL_SECOND_UV } from '../types.ts'
import { QUANTIZED } from './pageGeometryWgsl.ts'
import { normalAtlasWgsl } from './pageWgsl.ts'

/**
 * A page vertex's texture sets past the first, which the maps that ask for one read
 * (`physicalWgsl.ts`): from a quantized page, the sets its header says it stores (`clusterUv`), up
 * to eight; from a float geometry, the second set at the tail of the normal atlas, where the row's
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
}
/** Texture set \`uvSet\` of the three corners \`k\`, its header words read once. */
fn pageUvSet3(page:PageInfo,h:ClusterHeader,k:vec3u,uvSet:u32,end:u32)->mat3x2f{
 if(${QUANTIZED}){
  let t=clusterUvSet(h,page.pageOffset,uvSet);
  return mat3x2f(clusterUvAt(t,page.pageOffset,k.x),clusterUvAt(t,page.pageOffset,k.y),clusterUvAt(t,page.pageOffset,k.z));
 }
 return mat3x2f(vertUv1(end,page.vertexBase,k.x),vertUv1(end,page.vertexBase,k.y),vertUv1(end,page.vertexBase,k.z));
}`,
)

/** The coordinate of texture set `uvSet` of a vertex where the geometry stores it, else the
 *  first set: the one choice of a set the maps share (the cutout's `pageMaskUv`, the offset's
 *  graph, the displacement's height map). The program provides `normalTexels` and `pageUv`
 *  (`PAGE_GEOMETRY_WGSL`), as it did for each of them. */
export const PAGE_UV_OR_FIRST_WGSL = wgslBlock(
  'PAGE_UV_OR_FIRST_WGSL',
  [PAGE_UV_SET_WGSL],
  `fn pageUvOrFirst(page:PageInfo,h:ClusterHeader,vertex:u32,uvSet:u32)->vec2f{
 if(uvSet!=0u&&pageHasUvSet(page,h,uvSet)){return pageUvSet(page,h,vertex,uvSet,normalTexels());}
 return pageUv(page,h,vertex);
}`,
)

/**
 * The coordinate a row's base map is read at by the cutout and the shadow's transmittance — what
 * every vertex stage hands them (`visWgsl.ts`, `../raster/triWgsl.ts`,
 * `../../lighting/shadows/vsm/render/renderRasterWgsl.ts`, `../../lighting/shadows/vsm/transmission/transmissionRecordWgsl.ts`): the set the base map
 * reads (the row's three flags, `FLAG_MAP_UV_LOW`, glTF's `texCoord`) where the geometry stores it — a quantized
 * page in its header, a float geometry's second set in the normal atlas bound at `binding` —, else the first.
 */
export const maskUvWgsl = (binding: number) =>
  wgslBlock(
    `maskUvWgsl(${binding})`,
    [normalAtlasWgsl(binding), PAGE_UV_OR_FIRST_WGSL, MAP_UV_SET],
    `/** The texture set the row's base map reads: its two flags. */
fn pageMaskSet(page:PageInfo)->u32{
 return mapUvSetOf(page.flags);
}
fn pageMaskUv(page:PageInfo,h:ClusterHeader,vertex:u32)->vec2f{return pageUvOrFirst(page,h,vertex,pageMaskSet(page));}`,
  )
