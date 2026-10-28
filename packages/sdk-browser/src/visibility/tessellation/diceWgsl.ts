import { graphFrameWgsl } from '../shader/graphFrameWgsl.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { wpoGraphWgsl } from '../shader/wpoGraphWgsl.ts'
import { NO_MASKS, type MaskSet } from '../../materials/graph/maskProgram.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import {
  DATA_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
} from '../../materials/virtual/wgsl.ts'
import {
  PAGE_INFO_STRUCT_WGSL,
  VIS_UNIFORMS_WGSL,
  maskKeepWgsl,
  normalAtlasWgsl,
} from '../shader/pageWgsl.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL } from '../shader/pageGeometryWgsl.ts'
import { PAGE_UV_OR_FIRST_WGSL, maskUvWgsl } from '../shader/pageUvSetWgsl.ts'
import { FLAG_MASK } from '../types.ts'
import { MODE_DEPTH, MODE_ID } from '../raster/contract.ts'
import { RASTER_TRI_WGSL } from '../raster/triWgsl.ts'
import { pixelOffset, visWorkDeclaration, visWriteWgsl } from '../raster/pixelWgsl.ts'
import { visPageIndex, visTriangle } from '../visWords.ts'
import { TESS_BINDINGS, TESS_DECLARATIONS as D } from './bindings.ts'
import { ARG_VISIBLE, MAX_PATTERN_VERTICES, NEAR_CUT, NEAR_DROP } from './contract.ts'
import { DICE_CUTOUT_WGSL, DICE_PATCH_WGSL } from './diceSetupWgsl.ts'
import { displacedClip } from './domainWgsl.ts'
import { PATTERN_WGSL } from './patchWgsl.ts'
import { QUEUE_WGSL } from './queueWgsl.ts'
import { MAIN_VIEW_WGSL } from './viewWgsl.ts'

/**
 * The visibility write of a micro-triangle's pixel: covered when none of its three edge constants
 * is negative, the depth key of its plane there, the identifier of the SOURCE triangle — the pixel
 * is shaded from the triangle it was diced from (`../shader/prismWgsl.ts`) — under the rule both
 * rasters write by (`visWriteWgsl`). `RASTER_PIXEL_WGSL`'s without its cutout: a masked row's is
 * read at the vertices of its micro-triangles (`diceGroup`), where the pixels of one are all alike.
 */
const microPixel = (wide: boolean) =>
  wgslBlock(
    `MICRO_PIXEL_WGSL(${wide ? 'wide' : 'split'})`,
    [RASTER_TRI_WGSL, visWriteWgsl(wide), pixelOffset, visTriangle],
    `fn microPixel(t:Tri,pixel:vec2i,mode:u32){
 let c=edgesAt(t,pixel);
 if(min(c.x,min(c.y,c.z))<0.0){return;}
 let page=pages[t.row];
 let key=visKey(t.depth.x+t.depth.y*c.y+t.depth.z*c.z,page.depthBias);
 let offset=pixelOffset(vec2u(pixel));
 let ids=mode==${MODE_ID}u;
 if(!visPasses(offset,key,ids)){return;}
 visWrite(offset,key,page.packedBase|visTriangle(t.triangle),ids);
}
fn microTriangle(t:Tri,mode:u32){
 for(var y=t.minPixel.y;y<=t.maxPixel.y;y++){for(var x=t.minPixel.x;x<=t.maxPixel.x;x++){microPixel(t,vec2i(x,y),mode);}}
}`,
  )

/** The dicing's bindings, from the width of the visibility word. */
const diceBindingsText = (wide: boolean) => `${D.indices}
${D.positions}
${D.pages}
${D.uniform}
${D.tessUniform}
${D.tess}
${D.uvs}
${D.color}
${D.sampler}
${visWorkDeclaration(wide, TESS_BINDINGS.work)}
${tileDeclarations(TESS_BINDINGS.data, 'data')}
`

/** The group's memory; the clip positions of the vertices are kept only for a target that cuts at the near plane (`DiceTarget.cuts`). */
const diceWorkgroupText = (cuts: boolean) => `var<workgroup> groupPatches:u32;
var<workgroup> baseCorner:array<vec3f,3>;
var<workgroup> normalOf:array<vec3f,3>;
var<workgroup> coordinate:array<vec2f,3>;
var<workgroup> cutoutUv:array<vec2f,3>;
var<workgroup> cutoutAlpha:array<f32,3>;${cuts ? `\nvar<workgroup> clipOf:array<vec4f,${MAX_PATTERN_VERTICES}>;` : ''}
var<workgroup> verts:array<vec4f,${MAX_PATTERN_VERTICES}>;
var<workgroup> usable:array<u32,${MAX_PATTERN_VERTICES}>;
`

/**
 * What the dicing's group (`diceKernelText`) takes of the raster it writes to, the image's visibility buffer
 * or a shadow map's pool (`../../lighting/shadows/vsm/tessellation/shadowDiceWgsl.ts`): the text of these WGSL
 * functions, of fixed signature, which the program of a target declares beside the kernel —
 * - `diceCount(mode)`: the patches the entry point of `mode` dices; `dicePatchWord(mode, i)`: the word of the `tess` buffer
 *   the `i`-th of them lies at;
 * - `diceOpen(piece, lane, mode)`: a `DiceItem` — the page row the patch is diced from, the view (`TessView`) its factors are
 *   judged by, the winding the setup turns faces by (`det`) and what is done with a micro-triangle before the raster's near plane (`near`,
 *   `NEAR_DROP`, `NEAR_CUT` or `NEAR_KEEP`) —;
 *   run by every lane, it may fill the group's memory, a barrier follows;
 * - `diceSides(page)`: the page the setup reads its sides from; `diceClip(item, at, d, rec)`: a diced vertex's clip position on
 *   the raster's frame; `diceDraw(micro, mode)`: rasters a micro-triangle.
 * `entries` are the program's entry points, each calling `diceGroup(group, lane, n, mode)`.
 */
export interface DiceTarget {
  functions: string
  entries: string
  /** Whether it cuts micro-triangles by the near plane (`NEAR_CUT`): the group then keeps the clip positions of its vertices and declares `diceNear`. */
  cuts?: boolean
}

/** The cut of a micro-triangle by the near plane (`NEAR_CUT`), for a target that cuts: one with a corner short of the plane only (depth z / w above one, `w < z`); the others are set up whole. */
const DICE_NEAR_TEXT = `/** A micro-triangle of corners \`a\`, \`b\`, \`c\` in clip space, cut by the near plane (depth z / w at most one) and rastered: the part in front of
 *  the plane, a triangle or a quad of two. */
fn diceNear(tri:Tri,sides:PageInfo,det:f32,a:vec4f,b:vec4f,c:vec4f,mode:u32){
 var corner=array<vec4f,3>(a,b,c);
 var poly=array<vec4f,4>(a,a,a,a);
 var n=0u;
 for(var i=0u;i<3u;i++){
  let p=corner[i];let q=corner[(i+1u)%3u];
  let dp=p.w-p.z;let dq=q.w-q.z;
  if(dp>=0.0){poly[n]=p;n++;}
  if((dp>=0.0)!=(dq>=0.0)){poly[n]=mix(p,q,dp/(dp-dq));n++;}
 }
 for(var k=2u;k<n;k++){
  let micro=setupSubpixel(tri,sides,det,subpixelOf(poly[0]),subpixelOf(poly[k-1u]),subpixelOf(poly[k]));
  if(micro.ok!=0u){diceDraw(micro,mode);}
 }
}
`

/** The group's kernel, over the functions of a target (`DiceTarget`). */
const diceGroupText = (cuts: boolean) => `struct DiceItem{row:u32,view:TessView,det:f32,near:u32,}
${cuts ? DICE_NEAR_TEXT : ''}fn diceGroup(group:vec3u,lane:u32,n:vec3u,mode:u32){
 let first=flatIndex(group,n,1u)*tu.patchesPerGroup;
 if(lane==0u){
  let visible=diceCount(mode);
  groupPatches=select(0u,min(tu.patchesPerGroup,visible-first),first<visible);
 }
 let patches=workgroupUniformLoad(&groupPatches);
 for(var i=0u;i<patches;i++){
  let piece=loadPatch(dicePatchWord(mode,first+i));
  let item=diceOpen(piece,lane,mode);
  let view=item.view;
  let page=pages[item.row];
  let h=pageHeaderFor(page,true);
  let rec=displacementOf(page);
  let masked=(page.flags&${FLAG_MASK}u)!=0u;
  if(lane<3u){
   let corners=pageTriangle(page,h,visTriangle(piece.x));
   let v=select(select(corners.z,corners.y,lane==1u),corners.x,lane==0u);
   baseCorner[lane]=pagePosition(page,h,v);normalOf[lane]=pageNormal(page,h,v);coordinate[lane]=pageUvOrFirst(page,h,v,rec.map.y);
   if(masked){cutoutUv[lane]=pageMaskUv(page,h,v);cutoutAlpha[lane]=pageMaskAlpha(page,h,v);}
  }
  workgroupBarrier();
  let d=dicePatch(page,rec,piece,view,mat3x3f(baseCorner[0],baseCorner[1],baseCorner[2]),mat3x3f(normalOf[0],normalOf[1],normalOf[2]),mat3x2f(coordinate[0],coordinate[1],coordinate[2]));
  for(var v=lane;v<patternVertices(d.pattern);v+=WORKGROUP_THREADS){
   let at=diceVertex(d,rec,view,v);
   let clip=diceClip(item,at,d,rec);
   let sub=subpixelOf(clip);
${cuts ? '   clipOf[v]=clip;\n' : ''}   verts[v]=sub;
   // A vertex the cutout does not keep is as one behind the camera: its micro-triangles are not drawn.
   let kept=!masked||dicedKept(page,d,view,at,mat3x2f(cutoutUv[0],cutoutUv[1],cutoutUv[2]),vec3f(cutoutAlpha[0],cutoutAlpha[1],cutoutAlpha[2]));
   usable[v]=select(0u,1u,kept&&(item.near!=${NEAR_DROP}u||(clip.w>0.0&&sub.z<=1.0)));
  }
  workgroupBarrier();
  var tri:Tri;tri.row=item.row;tri.triangle=visTriangle(piece.x);
  for(var t=lane;t<patternTriangles(d.pattern);t+=WORKGROUP_THREADS){
   let c=patternCorners(d.pattern,t);
   if(usable[c.x]+usable[c.y]+usable[c.z]==3u){
    tri.ok=0u;
${
  cuts
    ? `    if(item.near==${NEAR_CUT}u&&(clipOf[c.x].w<clipOf[c.x].z||clipOf[c.y].w<clipOf[c.y].z||clipOf[c.z].w<clipOf[c.z].z)){diceNear(tri,diceSides(page),item.det,clipOf[c.x],clipOf[c.y],clipOf[c.z],mode);}
    else{`
    : '    {'
}
     let micro=setupSubpixel(tri,diceSides(page),item.det,verts[c.x],verts[c.y],verts[c.z]);
     if(micro.ok!=0u){diceDraw(micro,mode);}
    }
   }
  }
  workgroupBarrier();
 }
}
`

/** The dicing's memory and kernel over the functions and entry points of `target` (`DiceTarget`): a group takes `patchesPerGroup` patches of
 *  its list one after another, its sixty-four threads a patch's work. */
export const diceKernelText = (target: DiceTarget) =>
  `${diceWorkgroupText(!!target.cuts)}${diceGroupText(!!target.cuts)}${target.functions}\n${target.entries}`

/** The image's: its visibility buffer, in the two modes of the raster. */
const imageTarget: DiceTarget = {
  functions: `fn diceCount(mode:u32)->u32{return min(tw(tu.args+${ARG_VISIBLE}u),tu.maxVisible);}
fn dicePatchWord(mode:u32,i:u32)->u32{return tu.visible+i*4u;}
fn diceOpen(piece:vec4u,lane:u32,mode:u32)->DiceItem{
 let row=visPageIndex(piece.x);
 return DiceItem(row,mainView(),determinant(worldMatrix3(pages[row].world)),${NEAR_DROP}u);
}
fn diceSides(page:PageInfo)->PageInfo{return page;}
fn diceClip(item:DiceItem,at:DiceVertex,d:DicePatch,rec:DisplacementRecord)->vec4f{return displacedClip(at.point,at.height,rec.scale,d.fade,item.view.clip);}
fn diceDraw(micro:Tri,mode:u32){microTriangle(micro,mode);}`,
  entries: `@compute @workgroup_size(WORKGROUP_THREADS) fn tessDice${MODE_DEPTH}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) l:u32,@builtin(num_workgroups) n:vec3u){diceGroup(g,l,n,${MODE_DEPTH}u);}
@compute @workgroup_size(WORKGROUP_THREADS) fn tessDice${MODE_ID}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) l:u32,@builtin(num_workgroups) n:vec3u){diceGroup(g,l,n,${MODE_ID}u);}`,
}

/**
 * THE DICING of the visible patches, in the two modes of the raster (`MODE_DEPTH`, `MODE_ID`), a
 * group of `patchesPerGroup` patches that it takes one after another, its sixty-four threads a
 * patch's work: the source triangle's corners, normals and coordinates are read into the group's
 * memory; each thread then takes a vertex of the patch's pattern — a barycentric point of the
 * source triangle, its height read in the displacement's map at the level its micro-triangle's
 * size asks for, its clip position displaced by the fade of its depth (`displacedClip`) — until
 * every vertex is held on the subpixel grid; then each takes a triangle of the pattern, sets it up
 * (`setupSubpixel`, the rasters' own) and writes its pixels. A vertex behind the eye or in front of
 * the near plane drops the micro-triangles that use it; so does a vertex of a masked row the cutout
 * does not keep (`maskKeep`, at the vertex's own coordinate and alpha, read at the level the
 * micro-triangles' size asks for) — the cutout is judged at the vertices, never at the pixels.
 */
const dice = (wide: boolean) => `${diceBindingsText(wide)}${diceKernelText(imageTarget)}`

/** The dicing's program: its entry points `tessDice0` (depth) and `tessDice1` (identifiers). It reads the
 *  data atlas the height map lives in, and the geometry of the pass's pages as the rasters do. A surface
 *  whose graph wires an `opacityMask` is cut at the vertices by the graph's mask (`masks`), a vertex it
 *  does not keep dropping the micro-triangles that use it. With `wpo`, the corners of a patch's
 *  triangle are where its surface's offset puts them (`pagePosition`), the patch diced on the moved
 *  triangle. */
export const diceSource = (masks: MaskSet = NO_MASKS, wpo: WpoSet = NO_WPO, wide = false) =>
  wgslProgram(dice(wide), [
    PAGE_INFO_STRUCT_WGSL,
    VIS_UNIFORMS_WGSL,
    TILE_POOL_WGSL,
    DATA_SAMPLE_WGSL,
    normalAtlasWgsl(TESS_BINDINGS.normals),
    PAGE_GEOMETRY_WGSL,
    PAGE_NORMAL_WGSL,
    PAGE_UV_OR_FIRST_WGSL,
    maskUvWgsl(TESS_BINDINGS.normals),
    maskKeepWgsl(maskAlphaWgsl(false), masks, true),
    graphFrameWgsl(TESS_BINDINGS.frame),
    RASTER_TRI_WGSL,
    microPixel(wide),
    QUEUE_WGSL,
    PATTERN_WGSL,
    DICE_PATCH_WGSL,
    DICE_CUTOUT_WGSL,
    MAIN_VIEW_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    worldMatrix3,
    visPageIndex,
    visTriangle,
    displacedClip,
    ...(wpo.programs.length ? [materialTableWgsl(wpo.table), wpoGraphWgsl(wpo)] : []),
  ])
