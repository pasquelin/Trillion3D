import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { faceNormal, rayTriangleDistance } from '../../../../math/src/wgsl/geometry.ts'
import { bitIsSet, bitWord } from '../../../../math/src/wgsl/integer.ts'
import { CUT_RULE_WGSL } from '../../page/cut/rule.ts'
import { PAGE_POINTS_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts'
import { ROW_OF_PAGE_WGSL } from './rowHashWgsl.ts'

/**
 * WHAT A RAY MEETS OF ONE PAGE: the triangles the rasters draw of it, or nothing.
 *
 * A page is met only where the cut would draw it at no threshold — resident, and its finer group
 * not (`drawsCompared`, `../../page/cut/rule.ts`): the finest detail the pool holds, each surface
 * once, never a coarse cluster beside the finer one standing for it. Its row is found in the index
 * of the page table (`rowOfPage`, `rowHashWgsl.ts`), and its triangles decoded from that row as
 * every raster decodes them (`PAGE_POINTS_WGSL`): a quantized page in place, a float one from the
 * pool, and a deformed page at the positions this frame's deformation wrote — a skinned, morphed or
 * waved copy is met where it is drawn. A line, a point or a sprite has no area: it is never met.
 *
 * The test is the engine's (`rayTriangleDistance`), two-sided, in the placement's own space: the
 * ray's origin and direction are taken there by the inverse of its world, so a parameter along it
 * is the world distance. The hit keeps the placement, the page, the triangle's rank in it and its
 * face normal in that space, as its winding turns it.
 */
export const RAY_PAGE_WGSL = wgslBlock(
  'RAY_PAGE_WGSL',
  [
    PAGE_POINTS_WGSL,
    CUT_RULE_WGSL,
    ROW_OF_PAGE_WGSL,
    bitIsSet,
    bitWord,
    rayTriangleDistance,
    faceNormal,
  ],
  `struct RqHit{distance:f32,placement:u32,page:u32,triangle:u32,normal:vec3f,found:bool,}
/** Bit \`page\` of the residency set from word \`base\` of the cold table (\`../../gpu/dag/layout.ts\`). */
fn rqBit(base:u32,page:u32)->bool{return bitIsSet(coldAt(base+bitWord(page)),page);}
/** The nearest of \`best\` and the triangles of \`page\`, placement \`w\`'s, the ray meets. */
fn rqPage(origin:vec3f,direction:vec3f,page:u32,w:u32,best:RqHit)->RqHit{
 if(!drawsCompared(rqBit(0u,page),true,false,rqBit(params.childBase,page))){return best;}
 let row=rowOfPage(page);
 if(row==NO_ROW){return best;}
 let info=pages[row];
 if(info.lineWidth>0.0||info.sprite.y!=0.0){return best;}
 let h=pageHeaderFor(info,false);
 var out=best;
 let triangles=info.indexCount/3u;
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
