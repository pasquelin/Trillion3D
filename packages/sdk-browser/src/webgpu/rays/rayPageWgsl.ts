import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { faceNormal, rayTriangleDistance } from '../../../../math/src/wgsl/geometry.ts'
import { FLAG_CLUSTER_PAGE } from '../../visibility/types.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { PAGE_POINTS_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts'
import { DEFORMED_OF_PAGE_WGSL } from './deformIndexWgsl.ts'
import { RECORD_DRAWABLE, RECORD_NO_AREA, RECORD_WORDS } from './rayRecords.ts'

/**
 * WHAT A RAY MEETS OF ONE PAGE: the triangles the rasters draw of it, or nothing.
 *
 * The page's record (`rayRecords.ts`, `recordOf`: the page plus its placement's record shift) says
 * whether a ray tests it — the finest representation the pool holds, each surface once, drawn by a
 * view or not, opaque or blended — and where its geometry lies. Its triangles are decoded as every
 * raster decodes them (`PAGE_POINTS_WGSL`), from a page-table row the record and the deformation
 * index make (`deformedOf`): a quantized page in place, a float one from the pool, and a page this
 * frame deformed at the positions its row or its span named — a skinned, morphed or waved copy is
 * met where it is drawn. A line, a point or a sprite has no area: it is never met.
 *
 * The test is the engine's (`rayTriangleDistance`), two-sided, in the placement's own space: the
 * ray's origin and direction are taken there by the inverse of its world, so a parameter along it
 * is the world distance. The hit keeps the placement, the page, the triangle's rank in it and its
 * face normal in that space, as its winding turns it.
 */
export const RAY_PAGE_WGSL = wgslBlock(
  'RAY_PAGE_WGSL',
  [PAGE_INFO_STRUCT_WGSL, PAGE_POINTS_WGSL, DEFORMED_OF_PAGE_WGSL, rayTriangleDistance, faceNormal],
  `struct RqHit{distance:f32,placement:u32,page:u32,triangle:u32,normal:vec3f,found:bool,}
/** The nearest of \`best\` and the triangles of \`page\`, placement \`w\`'s, whose record is \`record\`. */
fn rqPage(origin:vec3f,direction:vec3f,page:u32,record:u32,w:u32,best:RqHit)->RqHit{
 let at=params.recordWord+record*${RECORD_WORDS}u;
 let flags=query[at+1u];
 if((flags&${RECORD_DRAWABLE}u)==0u||(flags&${RECORD_NO_AREA}u)!=0u){return best;}
 var info:PageInfo;
 info.flags=flags&${FLAG_CLUSTER_PAGE}u;
 info.pageOffset=query[at]-1u;
 info.vertexBase=query[at+2u];
 let deformed=deformedOf(page);
 info.deformOutput=deformed.x;
 info.packedBase=deformed.y;
 let h=pageHeaderFor(info,false);
 var out=best;
 let triangles=query[at+3u]/3u;
 for(var tri=0u;tri<triangles;tri++){
  let c=pageTriangle(info,h,tri);
  let a=pagePosition(info,h,c.x);
  let b=pagePosition(info,h,c.y);
  let e=pagePosition(info,h,c.z);
  let distance=rayTriangleDistance(origin,direction,a,b,e,out.distance);
  if(distance<out.distance){out=RqHit(distance,w,page,tri,faceNormal(a,b,e),true);}
 }
 return out;
}`,
)
