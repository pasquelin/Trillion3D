import { CNT_COARSE, CNT_FINE, CNT_LARGE, DISPATCH_BASE, FINE_PER_GROUP } from './contract.ts'
import { RASTER_TRI_WGSL } from './triWgsl.ts'
import { rasterListWgsl } from './kernelsWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import { DRAW_MASK_WGSL } from '../../geometry/dag/shader/drawMaskWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL } from '../shader/pageWgsl.ts'
import { DRAW_ITEM_WGSL, RASTER_HARDWARE, RASTER_SOFTWARE } from '../draw/contract.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS_WGSL,
} from '../../gpu/dispatch/grid.ts'
import { FLAG_DYNAMIC, FLAG_LINE, FLAG_SPRITE, FLAG_VOXEL } from '../types.ts'
import { VIS_TRIANGLE_BITS, visTriangle } from '../visWords.ts'
import { computeBufferEntries } from '../../gpu/core/computeBindings.ts'
import { TESSELLATED_ROW_WGSL } from '../tessellation/rowWgsl.ts'

/** The binning module's group 0, binding after binding: the page reads — the page table writable,
 *  where a row's measured bounds are kept (`PageInfo.edgeLength`) —, the image's uniform, the
 *  raster's `work` buffer the class lists live in, the cut's draw mask, and the draw records whose
 *  `raster` word the split writes. Six storage buffers: within the eight any device holds. */
export const binLayoutEntries = () =>
  computeBufferEntries([
    'read-only-storage',
    'read-only-storage',
    'storage',
    'uniform',
    'storage',
    'read-only-storage',
    'storage',
  ])

/**
 * THE CLUSTER SPLIT AND THE BINNING, one workgroup a page-table row, before either compaction
 * reads the rows (`../draw/shader.ts`).
 *
 * **The split** is the reference rule, made per cluster as the cut hands clusters on. A drawn row
 * is rastered in software unless:
 * - the software raster is off (`uni.softwareRaster`, the `softwareRaster` option);
 * - it is a line, a sprite or a voxel row, which the hardware vertex stage widens, turns or traces;
 * - its box needs clipping: a corner on or behind the near plane, or past the far one — the corners
 *   of the box of its vertices, through the same `viewProj * world` the raster uses —, or, where
 *   the cut culls by the view's clip plane (`uni.clipRoute`), a corner behind that plane: the
 *   hardware stages cut the cluster at the plane (`../../gpu/core/clipDistances.ts`), as the
 *   software raster cannot;
 * - or its longest edge, seen at the nearest point of its level-of-detail sphere, spans
 *   `hardwareRasterEdgePixels` or more: `projected < scale·edge·uni.hardwareEdge`, `projected` the
 *   sphere's nearest depth times the cosine of its tangent (`projectedEdgeScale`), `scale` the
 *   world's greatest axis scale, `uni.hardwareEdge` the view's pixels per unit at depth one divided
 *   by the threshold.
 * The sphere is the cluster's level-of-detail sphere, written with its row (`PageInfo.lodSphere`).
 * The edge and the box are the cluster's own — the longest edge and the extent of its triangles —,
 * measured once: the first binning after the row's upload reduces them over its triangles and keeps
 * them in the row (`PageInfo.edgeLength`, zero until then), every later image reads them there. A
 * row whose vertices move in place — a dynamic geometry, a deformation — is measured every image,
 * at the pose it draws, and judged at the sphere around that box: its rest bounds hold it nowhere.
 *
 * Every drawn row gets its `raster` word this image — a row the split hands back to hardware
 * clears the one it had. A software row then has its triangles set up (`setupTriangle`) and
 * appended to the list of their size class; a triangle that covers no pixel centre, or faces
 * away, is appended to none. The order within a list is invisible: the passes resolve each pixel
 * by a maximum (`VIS_WRITE_WGSL`).
 *
 * **The tessellation's rows** (`tessellated`): a row whose surface names a displacement and the frame
 * tessellates (`tessellatedRow`) is left to the tessellation, whose seeding (`../tessellation/`) turns
 * its triangles into patches: no list takes one of its triangles, and its `raster` word is the
 * software's, so the hardware compaction walks none of its slots. The text of the split without
 * the option is the same as it was.
 *
 * **One binning a pass of the cut.** A row is drawn by the pass whose mask holds it: the main
 * pass's binning reads the frame mask before the post pass, the post pass's the post mask, each
 * through the uniform entry it binds (`uni.selectionOffset`, `../passes/uniforms.ts`), and appends
 * to its own lists (`LIST`, the pipeline's override). The two masks hold no row in common, so each
 * row's `raster` word is written once an image, before the compaction of its pass reads it.
 */
export const binSource = (capacity: number, tessellated = false) =>
  wgslProgram(
    `@group(0) @binding(0) var<storage,read> indices:array<u32>;
@group(0) @binding(1) var<storage,read> positions:array<f32>;
@group(0) @binding(2) var<storage,read_write> pages:array<PageInfo>;
@group(0) @binding(3) var<uniform> uni:Uniforms;
@group(0) @binding(4) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read> selectionMask:array<u32>;
@group(0) @binding(6) var<storage,read_write> items:array<DrawItem>;
/** A bound past every coordinate a box holds. */
const FAR:f32=3.4e38;
/** The smaller of the sphere's two projected edge scales: its nearest depth, at least the near
 *  plane's, times the cosine of the angle from the view axis to its tangent nearest the axis; one
 *  under an orthographic projection, zero for a sphere wholly behind the near plane. \`center\` is
 *  camera-relative, in world units. */
fn projectedEdgeScale(center:vec3f,radius:f32)->f32{
 if(uni.perspective<=0.0){return 1.0;}
 let near=uni.near;
 let distSq=dot(center,center);
 let z=dot(uni.forward,center);
 let x=sqrt(max(0.0,distSq-z*z));
 let tangentSq=distSq-radius*radius;
 let tangent=sqrt(max(0.0,tangentSq));
 var cosine=(-radius*x+tangent*z)*(1.0/distSq);
 if(tangentSq<0.0||cosine*tangent<near){
  let h=near-z;
  let side=x+sqrt(radius*radius-h*h);
  cosine=near*inverseSqrt(side*side+near*near);
 }
 if(z+radius>near){return max(z-radius,near)*cosine;}
 return 0.0;
}
/** A row's bounds in its own space, as the split reads them: its vertex box's centre and half
 *  extent, and its longest edge. */
struct RowBounds{center:vec3f,extent:vec3f,edge:f32,}
/** Whether a row software may take (\`eligible\` below), of bounds \`b\`, is rastered in software
 *  this image (the split above); \`moving\` a row whose vertices move in place, judged at the
 *  sphere around its measured box. */
fn rasteredInSoftware(page:PageInfo,b:RowBounds,moving:bool)->bool{
 let m=pageTransform(page);
 var nearest=FAR;var deepest=FAR;var behind=FAR;
 for(var k=0u;k<8u;k++){
  let corner=b.center+b.extent*(vec3f(f32(k&1u),f32((k>>1u)&1u),f32((k>>2u)&1u))*2.0-1.0);
  let clip=m*vec4f(corner,1.0);
  nearest=min(nearest,clip.w-clip.z);deepest=min(deepest,clip.z);
  if(uni.clipRoute!=0u){behind=min(behind,dot(uni.clipPlane.xyz,(page.world*vec4f(corner,1.0)).xyz)+uni.clipPlane.w);}
 }
 if(nearest<=0.0||deepest<=0.0||behind<0.0){return false;}
 let world=worldMatrix3(page.world);
 let scale=sqrt(max(dot(world[0],world[0]),max(dot(world[1],world[1]),dot(world[2],world[2]))));
 var sphere=page.lodSphere;
 if(moving||sphere.w<0.0){sphere=vec4f(b.center,length(b.extent));}
 let center=(page.world*vec4f(sphere.xyz,1.0)).xyz-uni.eye;
 return !(projectedEdgeScale(center,sphere.w*scale)<scale*b.edge*uni.hardwareEdge);
}
// The row's longest squared edge and its box, lane by lane, then folded by the workgroup.
var<workgroup> edgeOf:array<f32,WORKGROUP_THREADS>;
var<workgroup> lowOf:array<vec3f,WORKGROUP_THREADS>;
var<workgroup> highOf:array<vec3f,WORKGROUP_THREADS>;
// What lane zero decides for the row and computes once for its triangles.
var<workgroup> rowSoftware:u32;
var<workgroup> rowVp:mat4x4f;
var<workgroup> rowDet:f32;
@compute @workgroup_size(WORKGROUP_THREADS) fn bin(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(group,n,1u);
 let live=row<uni.pageCount;
 let page=pages[select(0u,row,live)];
 let drawn=live&&(uni.selectionEnabled==0u||maskSelects(page.selectionIndex));
 let eligible=drawn&&uni.softwareRaster!=0u&&(page.flags&${FLAG_LINE | FLAG_SPRITE | FLAG_VOXEL}u)==0u${tessellated ? '&&!tessellatedRow(page)' : ''};
 let triangles=page.indexCount/3u;
 // Only a row the split may hand to software reads its triangles to measure its bounds: a row
 // whose vertices move in place every image, another once after its upload (\`PageInfo.edgeLength\`).
 let moving=(page.flags&${FLAG_DYNAMIC}u)!=0u||page.deformOutput!=0u;
 let measured=eligible&&triangles>0u&&(moving||page.edgeLength<=0.0);
 let h=pageHeaderFor(page,false);
 var edge=0.0;var low=vec3f(FAR);var high=vec3f(-FAR);
 for(var t=lane;t<select(0u,triangles,measured);t+=WORKGROUP_THREADS){
  let p=pageTrianglePositions(page,h,pageTriangle(page,h,t));
  let a=p[1]-p[0];let b=p[2]-p[1];let c=p[0]-p[2];
  edge=max(edge,max(dot(a,a),max(dot(b,b),dot(c,c))));
  low=min(low,min(p[0],min(p[1],p[2])));high=max(high,max(p[0],max(p[1],p[2])));
 }
 edgeOf[lane]=edge;lowOf[lane]=low;highOf[lane]=high;
 for(var stride=WORKGROUP_THREADS/2u;stride>0u;stride=stride/2u){
  workgroupBarrier();
  if(lane<stride){
   edgeOf[lane]=max(edgeOf[lane],edgeOf[lane+stride]);
   lowOf[lane]=min(lowOf[lane],lowOf[lane+stride]);highOf[lane]=max(highOf[lane],highOf[lane+stride]);
  }
 }
 workgroupBarrier();
 if(lane==0u){
  var bounds=RowBounds(page.boxCenter,page.boxExtent,page.edgeLength);
  if(measured){
   bounds=RowBounds((lowOf[0]+highOf[0])*0.5,(highOf[0]-lowOf[0])*0.5,sqrt(edgeOf[0]));
   // A row that keeps its pose keeps its measure until its next upload.
   if(!moving){pages[row].boxCenter=bounds.center;pages[row].boxExtent=bounds.extent;pages[row].edgeLength=bounds.edge;}
  }
  let software=eligible&&triangles>0u&&rasteredInSoftware(page,bounds,moving);
  if(drawn){items[row].raster=select(${RASTER_HARDWARE}u,${RASTER_SOFTWARE}u,software${tessellated ? '||tessellatedRow(page)' : ''});}
  rowSoftware=select(0u,1u,software);
  rowVp=pageTransform(page);rowDet=pageWinding(page);
 }
 if(workgroupUniformLoad(&rowSoftware)==0u){return;}
 for(var t=lane;t<triangles;t+=WORKGROUP_THREADS){
  let tri=setupTriangle(row,page,h,t,rowVp,rowDet);
  if(tri.ok==0u){continue;}
  let klass=triClass(tri);
  atomicStore(&work[classPlace(klass,atomicAdd(&work[LIST+klass],1u))],(row<<${VIS_TRIANGLE_BITS}u)|visTriangle(t));
 }
}
/** A class's dispatch of \`groups\` workgroups, in rows (\`groupGrid\`). */
fn spread(slot:u32,groups:u32){
 let base=LIST+${DISPATCH_BASE}u+slot*3u;let grid=groupGrid(groups);
 atomicStore(&work[base],grid.x);atomicStore(&work[base+1u],grid.y);atomicStore(&work[base+2u],1u);
}
/** Each count becomes its dispatch, without any going through the CPU. */
@compute @workgroup_size(1) fn plan(){
 spread(0u,ceilDiv(classCount(${CNT_FINE}u),${FINE_PER_GROUP}u));
 spread(1u,classCount(${CNT_COARSE}u));
 spread(2u,classCount(${CNT_LARGE}u));
}`,
    [
      PAGE_INFO_STRUCT_WGSL,
      VIS_UNIFORMS_WGSL,
      DRAW_ITEM_WGSL,
      RASTER_TRI_WGSL,
      rasterListWgsl(capacity),
      DRAW_MASK_WGSL,
      visTriangle,
      FLAT_INDEX_WGSL,
      GROUP_GRID_WGSL,
      WORKGROUP_THREADS_WGSL,
      ceilDivWgsl,
      ...(tessellated ? [TESSELLATED_ROW_WGSL] : []),
    ],
  )
