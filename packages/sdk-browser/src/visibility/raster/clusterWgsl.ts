import {
  LIST_AT,
  LIST_COUNT,
  MODE_DEPTH,
  MODE_ID,
  SCANLINE_SPAN,
  VERTEX_CACHE,
  rasterEntry,
} from './contract.ts'
import { FLAG_CLUSTER_PAGE, FLAG_MASK } from '../types.ts'

/**
 * Software raster of the clusters the bins listed (`../bins/binsWgsl.ts`): one group of sixty-four
 * threads to a cluster, the unit of work of the reference's own software rasterizer.
 *
 * **The group** reads its cluster's index off the pass's list (`LIST`, its header; a group past
 * the list's end leaves at once, the dispatch being cut to the count the bins made). It first
 * transforms the cluster's
 * vertices — each thread some of them — onto the subpixel grid (`subpixelOf`), once, into the
 * group's memory (`corner`, `VERTEX_CACHE` of them, the most an encoded cluster has); a row that
 * cannot be held there, an older cache's or one that is not a quantized page, transforms the
 * corners of each triangle as it sets it up, as it always did. Then each thread takes a triangle
 * at a time, `WORKGROUP_THREADS` a turn: it reads its corners out of the group's memory, sets it up
 * (`setupSubpixel`, the rasters' own) and rasters it itself.
 *
 * **A triangle is rastered by its box or by scanlines**, the reference's rule: the rows of its box
 * one pixel after another (`rasterRect`) unless one triangle of the lanes that run together spans
 * more than `SCANLINE_SPAN` pixels, when all of them take their covered span of each row
 * (`rasterScanline`) — the lanes agree by a subgroup vote where the device has subgroups, each by
 * its own triangle where it has none; the vote is taken in a loop every lane of the group runs the
 * same number of times, which the uniformity analysis cannot see (its bound is read off the page), so
 * its diagnostic is off. A masked row always takes scanlines. Both walk the pixels
 * with the edge constants stepped by the edge's own pixel steps, so a pixel's constants are
 * exactly the ones the setup defines, and write the covered ones (`writePixel`,
 * `./pixelWgsl.ts`).
 *
 * **The modes** (`MODE_DEPTH`, `MODE_ID`) are two entry points of the one text, as the visibility
 * write needs them (`visWriteWgsl`): a device with the 64-bit atomic maximum runs the first alone.
 * The identifiers of both passes are chosen once both passes' depths are down.
 */
/**
 * What a program's software raster rasters, and where: the one cluster kernel (`clusterRasterKernels`)
 * reads its item, transforms its vertices and writes its pixels through these, the camera's
 * (`clusterKernels`) and a shadow map's (`../../lighting/shadows/vsm/render/renderSoftwareWgsl.ts`).
 * - `item`: the text, run by the group's first lane with \`at\` (the group's flat rank), that may
 *   set \`groupRow\` to the row it rasters; it starts at \`NONE\`, a group with no row returns; `itemOwn`, run by every lane once the row is
 *   known, what each lane holds of the item (its private words).
 * - `frame`: what the group computes once for the row's triangles, \`page\` and \`h\` known, which
 *   declares \`det\` (the winding the setup turns faces by).
 * - `clip(v)`: the clip position of vertex `v` on the raster's frame (`rasterViewport`).
 * - `setupPage`: the page record the setup reads its sides from.
 * - `triangle`: what a set-up triangle takes of its corners \`k\` before it is rastered.
 * - `masked`, optional: the condition under which the row is a cutout (\`masked\`, which its corners read their coordinate for and which takes
 *   scanlines); the row's \`FLAG_MASK\` where it is not given.
 * - `entries`: the program's entry points, each calling \`clusterGroup(group,lane,n,mode)\`.
 * The program declares `writePixel(t,pixel,c,mode)`, the page rows and `flatIndex`.
 */
export interface ClusterRasterTarget {
  item: string
  itemOwn: string
  frame: string
  clip: (v: string) => string
  setupPage: string
  triangle: string
  masked?: string
  entries: string
}

/** The camera's cluster raster (`./shader.ts`): the pass's list of clusters (`LIST`), the page's
 *  world by the view-projection once a group (`pageTransform`), a masked row's cutout coordinate and
 *  vertex alpha at the corners, the two modes' entry points. */
const CAMERA_CLUSTER_TARGET: ClusterRasterTarget = {
  item: `groupRow=select(NONE,lists[lists[LIST+${LIST_AT}u]+at],at<lists[LIST+${LIST_COUNT}u]);`,
  itemOwn: '',
  frame: 'let vp=pageTransform(page);\n let det=pageWinding(page);',
  clip: (v) => `vp*vec4f(pagePosition(page,h,${v}),1.0)`,
  setupPage: 'page',
  triangle: `// A masked row's cutout coordinate and vertex alpha at its corners: the only one that pays the
   // read of its surface's header.
   if(t.ok!=0u&&masked){
    t.ua=vec3f(pageMaskUv(page,h,k.x),pageMaskAlpha(page,h,k.x));
    t.ub=vec3f(pageMaskUv(page,h,k.y),pageMaskAlpha(page,h,k.y));
    t.uc=vec3f(pageMaskUv(page,h,k.z),pageMaskAlpha(page,h,k.z));
   }`,
  entries: `@compute @workgroup_size(WORKGROUP_THREADS) fn ${rasterEntry(MODE_DEPTH)}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){clusterGroup(g,lane,n,${MODE_DEPTH}u);}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${rasterEntry(MODE_ID)}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){clusterGroup(g,lane,n,${MODE_ID}u);}`,
}

/** The camera's software raster kernels (`CAMERA_CLUSTER_TARGET`). */
export const clusterKernels = (subgroups: boolean) =>
  clusterRasterKernels(subgroups, CAMERA_CLUSTER_TARGET)

/** The kernels' header: the subgroup extension where used, the corners the group keeps. */
const clusterHeaderText = (subgroups: boolean) => `
${subgroups ? 'enable subgroups;\ndiagnostic(off,subgroup_uniformity);' : ''}
// The cluster's corners on the subpixel grid, and the cluster the group rasters (a past-the-end group
// reads \`NONE\`).
var<workgroup> corner:array<vec4f,${VERTEX_CACHE}>;
var<workgroup> groupRow:u32;
const NONE:u32=0xffffffffu;
`

/** The rect and scanline rasters of one triangle, which the dicing of the shadow maps' patches
 *  (`../../lighting/shadows/vsm/tessellation/shadowDiceWgsl.ts`) calls too. */
export const TRIANGLE_RASTERS_TEXT = `/** Rasters the triangle \`t\` row by row over its box. */
fn rasterRect(t:Tri,mode:u32){
 var cy=t.c;
 var y=t.minPixel.y;
 loop{
  var cx=cy;
  var x=t.minPixel.x;
  loop{
   if(min(cx.x,min(cx.y,cx.z))>=0.0){writePixel(t,vec2i(x,y),cx,mode);}
   if(x>=t.maxPixel.x){break;}
   cx=cx-vec3f(t.e12.y,t.e20.y,t.e01.y);
   x=x+1;
  }
  if(y>=t.maxPixel.y){break;}
  cy=cy+vec3f(t.e12.x,t.e20.x,t.e01.x);
  y=y+1;
 }
}
/** Rasters the triangle \`t\` row by row over the span of each row its edges cover: an opening edge
 *  starts the span where it is crossed, a closing one ends it. */
fn rasterScanline(t:Tri,mode:u32){
 var cy=t.c;
 let edge=vec3f(t.e12.y,t.e20.y,t.e01.y);
 let opening=edge<vec3f(0.0);
 let invEdge=select(vec3f(1.0)/edge,vec3f(1e8),edge==vec3f(0.0));
 let width=f32(t.maxPixel.x-t.minPixel.x);
 var y=t.minPixel.y;
 loop{
  let crossing=cy*invEdge;
  let entering=select(vec3f(0.0),crossing,opening);
  let leaving=select(crossing,vec3f(width),opening);
  let x0=ceil(max(entering.x,max(entering.y,entering.z)));
  let x1=min(leaving.x,min(leaving.y,leaving.z));
  var cx=cy-edge*x0;
  var x=x0;
  loop{
   if(x>x1){break;}
   if(min(cx.x,min(cx.y,cx.z))>=0.0){writePixel(t,vec2i(i32(x)+t.minPixel.x,y),cx,mode);}
   cx=cx-edge;
   x=x+1.0;
  }
  if(y>=t.maxPixel.y){break;}
  cy=cy+vec3f(t.e12.x,t.e20.x,t.e01.x);
  y=y+1;
 }
}
`

/** The kernel of one group of a cluster page: its triangles set up and rastered. */
const clusterGroupText = (
  subgroups: boolean,
  target: ClusterRasterTarget,
) => `fn clusterGroup(group:vec3u,lane:u32,n:vec3u,mode:u32){
 let at=flatIndex(group,n,1u);
 if(lane==0u){
  groupRow=NONE;
  ${target.item}
 }
 let row=workgroupUniformLoad(&groupRow);
 if(row==NONE){return;}
 ${target.itemOwn}
 let page=pages[row];
 let masked=${target.masked ?? `(page.flags&${FLAG_MASK}u)!=0u`};
 let h=pageHeaderFor(page,masked);
 ${target.frame}
 let triangles=page.indexCount/3u;
 let held=(page.flags&${FLAG_CLUSTER_PAGE}u)!=0u&&h.vertexCount<=${VERTEX_CACHE}u;
 if(held){
  for(var v=lane;v<h.vertexCount;v+=WORKGROUP_THREADS){
   corner[v]=subpixelOf(${target.clip('v')});
  }
 }
 workgroupBarrier();
 for(var first=0u;first<triangles;first+=WORKGROUP_THREADS){
  let triangle=first+lane;
  var t:Tri;t.ok=0u;
  if(triangle<triangles){
   t.row=row;t.triangle=triangle;
   let k=pageTriangle(page,h,triangle);
   t.corners=k;
   var s0:vec4f;var s1:vec4f;var s2:vec4f;
   if(held){s0=corner[k.x];s1=corner[k.y];s2=corner[k.z];}
   else{
    s0=subpixelOf(${target.clip('k.x')});
    s1=subpixelOf(${target.clip('k.y')});
    s2=subpixelOf(${target.clip('k.z')});
   }
   t=setupSubpixel(t,${target.setupPage},det,s0,s1,s2);
   ${target.triangle}
  }
  let spans=t.ok!=0u&&t.maxPixel.x-t.minPixel.x>${SCANLINE_SPAN};
  let voted=${subgroups ? 'subgroupAny(spans)' : 'spans'};
  if(t.ok!=0u){
   if(masked||voted){rasterScanline(t,mode);}else{rasterRect(t,mode);}
  }
 }
}
`

/** The cluster raster's kernels of `target` (`ClusterRasterTarget`), the lanes voting by subgroup
 *  where the device has them (`subgroups`). */
export const clusterRasterKernels = (subgroups: boolean, target: ClusterRasterTarget) =>
  `${clusterHeaderText(subgroups)}${TRIANGLE_RASTERS_TEXT}${clusterGroupText(subgroups, target)}${target.entries}
`
