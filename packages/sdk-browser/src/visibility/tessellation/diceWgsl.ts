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
import { maskUvWgsl } from '../shader/pageUvSetWgsl.ts'
import { FLAG_MASK } from '../types.ts'
import { MODE_DEPTH, MODE_ID } from '../raster/contract.ts'
import { RASTER_TRI_WGSL } from '../raster/triWgsl.ts'
import { VIS_WRITE_WGSL, pixelOffset } from '../raster/pixelWgsl.ts'
import { visPageIndex, visTriangle } from '../visWords.ts'
import { TESS_BINDINGS, TESS_DECLARATIONS as D } from './bindings.ts'
import { ARG_VISIBLE, MAX_PATTERN_VERTICES } from './contract.ts'
import { DICE_PATCH_WGSL, DISPLACE_UV } from './diceSetupWgsl.ts'
import { displacedClip, uvDerivative } from './domainWgsl.ts'
import { PATTERN_WGSL } from './patchWgsl.ts'
import { QUEUE_WGSL } from './queueWgsl.ts'
import { MAIN_VIEW_WGSL } from './viewWgsl.ts'

/**
 * The visibility write of a micro-triangle's pixel: covered when none of its three edge constants
 * is negative, the depth key of its plane there, the identifier of the SOURCE triangle — the pixel
 * is shaded from the triangle it was diced from (`../shader/prismWgsl.ts`) — under the rule both
 * rasters write by (`VIS_WRITE_WGSL`). `RASTER_PIXEL_WGSL`'s without its cutout: a masked row's is
 * read at the vertices of its micro-triangles (`diceGroup`), where the pixels of one are all alike.
 */
const MICRO_PIXEL = wgslBlock(
  'MICRO_PIXEL_WGSL',
  [RASTER_TRI_WGSL, VIS_WRITE_WGSL, pixelOffset, visTriangle],
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
const DICE = `${D.indices}
${D.positions}
${D.pages}
${D.uniform}
${D.tessUniform}
${D.tess}
${D.uvs}
${D.color}
${D.sampler}
${D.work}
${tileDeclarations(TESS_BINDINGS.data, 'data')}
var<workgroup> groupPatches:u32;
var<workgroup> baseCorner:array<vec3f,3>;
var<workgroup> normalOf:array<vec3f,3>;
var<workgroup> coordinate:array<vec2f,3>;
var<workgroup> cutoutUv:array<vec2f,3>;
var<workgroup> cutoutAlpha:array<f32,3>;
var<workgroup> verts:array<vec4f,${MAX_PATTERN_VERTICES}>;
var<workgroup> usable:array<u32,${MAX_PATTERN_VERTICES}>;
fn diceGroup(group:vec3u,lane:u32,n:vec3u,mode:u32){
 let first=flatIndex(group,n,1u)*tu.patchesPerGroup;
 if(lane==0u){
  let visible=min(tw(tu.args+${ARG_VISIBLE}u),tu.maxVisible);
  groupPatches=select(0u,min(tu.patchesPerGroup,visible-first),first<visible);
 }
 let patches=workgroupUniformLoad(&groupPatches);
 for(var i=0u;i<patches;i++){
  let piece=loadPatch(tu.visible+(first+i)*4u);
  let row=visPageIndex(piece.x);
  let page=pages[row];
  let h=pageHeaderFor(page,true);
  let rec=displacementOf(page);
  let masked=(page.flags&${FLAG_MASK}u)!=0u;
  if(lane<3u){
   let corners=pageTriangle(page,h,visTriangle(piece.x));
   let v=select(select(corners.z,corners.y,lane==1u),corners.x,lane==0u);
   baseCorner[lane]=pagePosition(page,h,v);normalOf[lane]=pageNormal(page,h,v);coordinate[lane]=displaceUv(page,h,v,rec.map.y);
   if(masked){cutoutUv[lane]=pageMaskUv(page,h,v);cutoutAlpha[lane]=pageMaskAlpha(page,h,v);}
  }
  workgroupBarrier();
  let view=mainView();
  let d=dicePatch(page,rec,piece,view,mat3x3f(baseCorner[0],baseCorner[1],baseCorner[2]),mat3x3f(normalOf[0],normalOf[1],normalOf[2]),mat3x2f(coordinate[0],coordinate[1],coordinate[2]));
  let det=determinant(worldMatrix3(page.world));
  for(var v=lane;v<patternVertices(d.pattern);v+=WORKGROUP_THREADS){
   let at=diceVertex(d,rec,view,v);
   let clip=displacedClip(at.point,at.height,rec.scale,d.fade,view.clip);
   let sub=subpixelOf(clip);
   verts[v]=sub;
   // A vertex the cutout does not keep is sent behind the camera, with the micro-triangles that use it.
   var kept=true;
   if(masked){
    let m=uvDerivative(at.point.clip.w,d.density[pageMaskSet(page)],view.edgesPerUnit,tu.piecesPerEdge,view.perspective);
    kept=maskKeep(page,mat3x2f(cutoutUv[0],cutoutUv[1],cutoutUv[2])*at.b,dot(vec3f(cutoutAlpha[0],cutoutAlpha[1],cutoutAlpha[2]),at.b),vec2f(m),vec2f(m));
   }
   usable[v]=select(0u,1u,kept&&clip.w>0.0&&sub.z<=1.0);
  }
  workgroupBarrier();
  var tri:Tri;tri.row=row;tri.triangle=visTriangle(piece.x);
  for(var t=lane;t<patternTriangles(d.pattern);t+=WORKGROUP_THREADS){
   let c=patternCorners(d.pattern,t);
   if(usable[c.x]+usable[c.y]+usable[c.z]==3u){
    tri.ok=0u;
    let micro=setupSubpixel(tri,page,det,verts[c.x],verts[c.y],verts[c.z]);
    if(micro.ok!=0u){microTriangle(micro,mode);}
   }
  }
  workgroupBarrier();
 }
}
@compute @workgroup_size(WORKGROUP_THREADS) fn tessDice${MODE_DEPTH}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) l:u32,@builtin(num_workgroups) n:vec3u){diceGroup(g,l,n,${MODE_DEPTH}u);}
@compute @workgroup_size(WORKGROUP_THREADS) fn tessDice${MODE_ID}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) l:u32,@builtin(num_workgroups) n:vec3u){diceGroup(g,l,n,${MODE_ID}u);}`

/** The dicing's program: its entry points `tessDice0` (depth) and `tessDice1` (identifiers). It reads the
 *  data atlas the height map lives in, and the geometry of the pass's pages as the rasters do. */
export const diceSource = () =>
  wgslProgram(DICE, [
    PAGE_INFO_STRUCT_WGSL,
    VIS_UNIFORMS_WGSL,
    TILE_POOL_WGSL,
    DATA_SAMPLE_WGSL,
    normalAtlasWgsl(TESS_BINDINGS.normals),
    PAGE_GEOMETRY_WGSL,
    PAGE_NORMAL_WGSL,
    DISPLACE_UV,
    maskUvWgsl(TESS_BINDINGS.normals),
    maskKeepWgsl(maskAlphaWgsl(false)),
    RASTER_TRI_WGSL,
    MICRO_PIXEL,
    QUEUE_WGSL,
    PATTERN_WGSL,
    DICE_PATCH_WGSL,
    MAIN_VIEW_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    worldMatrix3,
    visPageIndex,
    visTriangle,
    displacedClip,
    uvDerivative,
  ])
