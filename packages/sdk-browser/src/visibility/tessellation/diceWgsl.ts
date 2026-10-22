import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { DATA_SAMPLE_WGSL, TILE_POOL_WGSL, tileDeclarations } from '../../materials/virtual/wgsl.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL, normalAtlasWgsl } from '../shader/pageWgsl.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL } from '../shader/pageGeometryWgsl.ts'
import { PAGE_UV_SET_WGSL } from '../shader/pageUvSetWgsl.ts'
import { MODE_DEPTH, MODE_ID } from '../raster/contract.ts'
import { RASTER_TRI_WGSL } from '../raster/triWgsl.ts'
import { VIS_WRITE_WGSL, pixelOffset } from '../raster/pixelWgsl.ts'
import { visPageIndex, visTriangle } from '../visWords.ts'
import { TESS_BINDINGS, TESS_DECLARATIONS as D } from './bindings.ts'
import { ARG_VISIBLE, MAX_PATTERN_VERTICES } from './contract.ts'
import { QUEUE_WGSL } from './queueWgsl.ts'
import {
  PATTERN_WGSL,
  decodeBarycentrics,
  edgeFactors,
  lowTessDistance,
  patchBarycentrics,
  patternOf,
  sortedFactors,
} from './patchWgsl.ts'
import {
  displacedClip,
  displacementFade,
  domainPoint,
  uvDerivative,
  worldPerUv,
} from './domainWgsl.ts'

/** The coordinate a height map is read at, at the vertex `vertex` of a page: the texture set the
 *  displacement names where the geometry stores it, the first set else (`pageUvSet`). */
const DISPLACE_UV = wgslBlock(
  'DISPLACE_UV_WGSL',
  [PAGE_UV_SET_WGSL],
  `fn displaceUv(page:PageInfo,h:ClusterHeader,vertex:u32,uvSet:u32)->vec2f{
 if(uvSet!=0u&&pageHasUvSet(page,h,uvSet)){return pageUvSet(page,h,vertex,uvSet,normalTexels());}
 return pageUv(page,h,vertex);
}`,
)

/**
 * The visibility write of a micro-triangle's pixel: covered when none of its three edge constants
 * is negative, the depth key of its plane there, the identifier of the SOURCE triangle — the pixel
 * is shaded from the triangle it was diced from (`../shader/prismWgsl.ts`) — under the rule both
 * rasters write by (`VIS_WRITE_WGSL`). `RASTER_PIXEL_WGSL`'s without its cutout: a row that is masked
 * is not tessellated.
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
 * the near plane drops the micro-triangles that use it.
 */
const DICE = `${D.indices}
${D.positions}
${D.pages}
${D.uniform}
${D.tessUniform}
${D.tess}
${D.disp}
${D.uvs}
${D.sampler}
${D.work}
${tileDeclarations(TESS_BINDINGS.data, 'data')}
var<workgroup> groupPatches:u32;
var<workgroup> baseCorner:array<vec3f,3>;
var<workgroup> normalOf:array<vec3f,3>;
var<workgroup> coordinate:array<vec2f,3>;
var<workgroup> verts:array<vec4f,${MAX_PATTERN_VERTICES}>;
var<workgroup> usable:array<u32,${MAX_PATTERN_VERTICES}>;
fn diceGroup(group:vec3u,lane:u32,n:vec3u,mode:u32){
 let first=flatIndex(group,n,1u)*tu.patchesPerGroup;
 if(lane==0u){
  let visible=min(tw(tu.args+${ARG_VISIBLE}u),tu.maxVisible);
  groupPatches=select(0u,min(tu.patchesPerGroup,visible-first),first<visible);
 }
 let patches=workgroupUniformLoad(&groupPatches);
 let perspective=uni.perspective>0.0;
 for(var i=0u;i<patches;i++){
  let piece=loadPatch(tu.visible+(first+i)*4u);
  let row=visPageIndex(piece.x);
  let page=pages[row];
  let h=pageHeaderFor(page,true);
  let rec=displacementOf(page);
  if(lane<3u){
   let corners=pageTriangle(page,h,visTriangle(piece.x));
   let v=select(select(corners.z,corners.y,lane==1u),corners.x,lane==0u);
   baseCorner[lane]=pagePosition(page,h,v);normalOf[lane]=pageNormal(page,h,v);coordinate[lane]=displaceUv(page,h,v,rec.map.y);
  }
  workgroupBarrier();
  let p=mat3x3f(baseCorner[0],baseCorner[1],baseCorner[2]);
  let nrm=mat3x3f(normalOf[0],normalOf[1],normalOf[2]);
  let uv=mat3x2f(coordinate[0],coordinate[1],coordinate[2]);
  let world=page.world;
  let det=determinant(worldMatrix3(world));
  let parent=mat3x3f(decodeBarycentrics(piece.y),decodeBarycentrics(piece.z),decodeBarycentrics(piece.w));
  let c0=(world*vec4f(p*parent[0],1.0)).xyz;let c1=(world*vec4f(p*parent[1],1.0)).xyz;let c2=(world*vec4f(p*parent[2],1.0)).xyz;
  let depth=vec3f(dot(uni.forward,c0-uni.eye),dot(uni.forward,c1-uni.eye),dot(uni.forward,c2-uni.eye));
  let axes=worldMatrix3(world);
  let scale=sqrt(max(dot(axes[0],axes[0]),max(dot(axes[1],axes[1]),dot(axes[2],axes[2]))));
  let far=lowTessDistance(max(-rec.bounds.x,rec.bounds.y),scale,tu.lodScale,rec.bounds.z*tu.edgesPerPixel);
  let sorted=sortedFactors(edgeFactors(mat3x3f(c0,c1,c2),depth,uni.near,perspective,tu.lodScale,tu.invDiceRate,far));
  let pattern=patternAt(patternOf(sorted.factors,sorted.flip));
  let ordered=mat3x3f(parent[sorted.corners.x],parent[sorted.corners.y],parent[sorted.corners.z]);
  let fade=displacementFade(rec.scale,rec.bounds,scale,tu.lodScale,tu.edgesPerPixel,perspective);
  let source=mat3x3f((world*vec4f(p[0],1.0)).xyz,(world*vec4f(p[1],1.0)).xyz,(world*vec4f(p[2],1.0)).xyz);
  let perUv=worldPerUv(source,uv);
  for(var v=lane;v<patternVertices(pattern);v+=WORKGROUP_THREADS){
   let b=patchBarycentrics(ordered[0],ordered[1],ordered[2],patternVertex(pattern,v));
   let point=domainPoint(b,p,nrm,uv,world,uni.viewProj);
   let step=uvDerivative(point.clip.w,perUv,tu.lodScale,tu.invDiceRate,perspective);
   let height=dataSample(rec.map.x,point.uv,vec2f(step),vec2f(step),true).x;
   let clip=displacedClip(point,height,rec.scale,fade,uni.viewProj);
   let sub=subpixelOf(clip);
   verts[v]=sub;
   usable[v]=select(0u,1u,clip.w>0.0&&sub.z<=1.0);
  }
  workgroupBarrier();
  var tri:Tri;tri.row=row;tri.triangle=visTriangle(piece.x);
  for(var t=lane;t<patternTriangles(pattern);t+=WORKGROUP_THREADS){
   let c=patternCorners(pattern,t);
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
    RASTER_TRI_WGSL,
    MICRO_PIXEL,
    QUEUE_WGSL,
    PATTERN_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    worldMatrix3,
    visPageIndex,
    visTriangle,
    decodeBarycentrics,
    edgeFactors,
    lowTessDistance,
    patchBarycentrics,
    patternOf,
    sortedFactors,
    displacedClip,
    displacementFade,
    domainPoint,
    uvDerivative,
    worldPerUv,
  ])
