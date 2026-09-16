import { ATLAS_SLOTS_WGSL, COLOR_ALPHA_WGSL, atlasTextures } from './webgpuAtlasWgsl.ts';
import {
  BARY_WEIGHTS_WGSL,
  EDGE_WGSL,
  MASK_KEEP_WGSL,
  PAGE_INFO_STRUCT_WGSL,
} from './visibilityPageWgsl.ts';
import { SMALL_BINDINGS } from './webgpuBindLayout.ts';

/** Compute raster for sub-eight-pixel opaque triangles. Hardware renders the complementary set. */
const PAGE_INFO = `${PAGE_INFO_STRUCT_WGSL}
struct Uniforms{viewProj:mat4x4f,viewport:vec2f,smallThreshold:f32,pageCount:u32,drawSlot:u32,indirect:u32,selectionOffset:u32,selectionEnabled:u32,}`;
/** Workgroups per dispatch dimension guaranteed by WebGPU; the small-triangle list is split across x and y. */
export const DISPATCH_SPAN = 65535;
/**
 * Words the list reserves before its entries: one count per size class, then one dispatch each.
 * The two classes share one list — the fine one fills it from the front, the coarse one from the back —
 * so no class can overflow while the other has room, and the bound stays every triangle of every row.
 */
export const LIST_HEADER = 8;
/** Pixels a side of the fine class, and how many of its triangles one 64-lane workgroup rasters. */
const FINE_SIDE = 4,
  FINE_PER_GROUP = 64 / (FINE_SIDE * FINE_SIDE);
export const rasterSource = (capacity: number, listBase: number) => `${PAGE_INFO}
@group(0) @binding(${SMALL_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${SMALL_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${SMALL_BINDINGS.hizFlags}) var<storage,read> hizFlags:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.uniform}) var<uniform> uni:Uniforms;
@group(0) @binding(${SMALL_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;
${atlasTextures(SMALL_BINDINGS.maps, 'maps')}
@group(0) @binding(${SMALL_BINDINGS.sampler}) var mapsSampler:sampler;
// Un seul tampon de travail : d'abord les deux attachements que le raster résout — la profondeur,
// puis les identifiants un écran plus loin —, et à partir de LIST la liste des petits triangles,
// son compte, la répartition qu'il implique, puis une ligne et un triangle empaquetés par entrée.
@group(0) @binding(${SMALL_BINDINGS.work}) var<storage,read_write> work:array<atomic<u32>>;
const LIST:u32=${listBase}u;
@group(0) @binding(${SMALL_BINDINGS.selectionMask}) var<storage,read> selectionMask:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.colorSlots}) var<storage,read> colorSlots:array<vec2u>;
${ATLAS_SLOTS_WGSL}
${COLOR_ALPHA_WGSL}
fn pixelCount()->u32{return u32(uni.viewport.x)*u32(uni.viewport.y);}
// Le produit \`viewProj * world\` et le determinant de la partie lineaire ne dependent que de la page :
// ils sont calcules une fois pour la page et relus tels quels par chacun de ses triangles. Les memes
// operandes dans le meme ordre donnent la meme valeur flottante qu'un calcul par triangle.
fn pageTransform(page:PageInfo)->mat4x4f{return uni.viewProj*page.world;}
fn pageWinding(page:PageInfo)->f32{return determinant(mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz));}
fn vertex(vp:mat4x4f,vertexBase:u32,index:u32)->vec4f{
 let base=(vertexBase+index)*3u;
 return vp*vec4f(positions[base],positions[base+1u],positions[base+2u],1.0);
}
fn uv(page:PageInfo,index:u32)->vec2f{let base=(page.vertexBase+index)*2u;return vec2f(uvs[base],uvs[base+1u]);}
${EDGE_WGSL}
${BARY_WEIGHTS_WGSL}
fn screen(p:vec4f)->vec2f{return vec2f((p.x/p.w*0.5+0.5)*uni.viewport.x,(1.0-(p.y/p.w*0.5+0.5))*uni.viewport.y);}
${MASK_KEEP_WGSL}
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) gid:vec3u){
 let offset=gid.x;let pixels=pixelCount();if(offset>=pixels){return;}
 // Profondeur inversee : le tampon part du LOINTAIN (0) et le gagnant est le maximum.
 atomicStore(&work[offset],bitcast<u32>(0.0));atomicStore(&work[pixels+offset],0xffffffffu);
}
// Everything a triangle decides before a pixel is named. The binning pass evaluates it once per
// triangle and the two raster passes replay it for the survivors only, from the same inputs, so the
// set that reaches a pixel is the same one a per-pixel evaluation would have reached.
struct Tri{ok:u32,row:u32,triangle:u32,a:vec2f,b:vec2f,c:vec2f,ca:vec4f,cb:vec4f,cc:vec4f,ia:u32,ib:u32,ic:u32,area:f32,lo:vec2f,span:f32,}
fn setupTriangle(pageIndex:u32,triangle:u32,vp:mat4x4f,det:f32)->Tri{
 var t:Tri;t.ok=0u;t.row=pageIndex;t.triangle=triangle;
 let page=pages[pageIndex];
 if(uni.selectionEnabled!=0u&&selectionMask[uni.selectionOffset+page.selectionIndex]==0u){return t;}
 if(triangle*3u+2u>=page.indexCount){return t;}
 if(page.hizSlot!=0xffffffffu&&hizFlags[page.hizSlot]!=0u){return t;}
 let ia=indices[page.pageOffset+triangle*3u];let ib=indices[page.pageOffset+triangle*3u+1u];let ic=indices[page.pageOffset+triangle*3u+2u];
 let ca=vertex(vp,page.vertexBase,ia);let cb=vertex(vp,page.vertexBase,ib);let cc=vertex(vp,page.vertexBase,ic);
 if(ca.w<=0.0||cb.w<=0.0||cc.w<=0.0||ca.z<0.0||cb.z<0.0||cc.z<0.0||ca.z>ca.w||cb.z>cb.w||cc.z>cc.w){return t;}
 let a=screen(ca);let b=screen(cb);let c=screen(cc);
 let lo=min(a,min(b,c));let hi=max(a,max(b,c));
 if(lo.x<0.0||lo.y<0.0||hi.x>=uni.viewport.x||hi.y>=uni.viewport.y||hi.x-lo.x>uni.smallThreshold||hi.y-lo.y>uni.smallThreshold){return t;}
 let area=edge(a,b,c);if(abs(area)<1e-8){return t;}
 let front=select((area > 0.0),(area < 0.0),(det >= 0.0));
 if((page.flags&2u)==0u){if((page.flags&256u)!=0u){if(front){return t;}}else if(!front){return t;}}
 t.ok=1u;t.a=a;t.b=b;t.c=c;t.ca=ca;t.cb=cb;t.cc=cc;t.ia=ia;t.ib=ib;t.ic=ic;t.area=area;t.lo=lo;
 t.span=max(hi.x-lo.x,hi.y-lo.y);
 return t;
}
fn rasterPixel(t:Tri,lane:vec2u,writeId:bool){
 let page=pages[t.row];let triangle=t.triangle;
 let pixel=vec2i(floor(t.lo))+vec2i(lane);
 if(pixel.x<0||pixel.y<0||pixel.x>=i32(uni.viewport.x)||pixel.y>=i32(uni.viewport.y)){return;}
 let sample=vec2f(pixel)+vec2f(0.5);
 let bw=baryWeights(t.a,t.b,t.c,sample,t.area);let wa=bw.x;let wb=bw.y;let wc=bw.z;
 if(wa<0.0||wb<0.0||wc<0.0){return;}
 let depth=wa*t.ca.z/t.ca.w+wb*t.cb.z/t.cb.w+wc*t.cc.z/t.cc.w;
 if(depth<=0.0||depth>1.0){return;}
 if((page.flags&128u)!=0u){let inv=wa/t.ca.w+wb/t.cb.w+wc/t.cc.w;let tc=(uv(page,t.ia)*(wa/t.ca.w)+uv(page,t.ib)*(wb/t.cb.w)+uv(page,t.ic)*(wc/t.cc.w))/inv;if(!maskKeep(page,tc)){return;}}
 let offset=u32(pixel.y)*u32(uni.viewport.x)+u32(pixel.x);
 // La couche coplanaire du cluster est un décalage entier sur la clé de profondeur, appliqué avant
 // l'empaquetage : pour une profondeur positive, les bits IEEE-754 croissent avec la valeur, et la
 // profondeur du moteur est inversée, donc AJOUTER des unités rapproche exactement d'autant de
 // derniers bits, plafonné aux bits du plan proche. Zéro pour la couche 0.
 let raw=bitcast<u32>(depth);
 let bits=min(0x3f800000u,raw+page.depthBias);
 if(writeId){if(atomicLoad(&work[offset])==bits){atomicMin(&work[pixelCount()+offset],page.packedBase|(triangle&0xffu));}}
 else{atomicMax(&work[offset],bits);}
}
// A dispatch dimension tops out at 65 535 groups, far below the page count a replicated scene
// reaches, so the page row is split over y and z and bounded against the live row count.
fn pageRow(group:vec3u)->u32{return group.y+group.z*${DISPATCH_SPAN}u;}
// Les 64 fils d'un groupe de tri partagent la meme page : le fil zero calcule pour eux les deux
// quantites qui n'appartiennent qu'a la page, et les 63 autres les relisent au lieu de les refaire.
var<workgroup> rowVp:mat4x4f;
var<workgroup> rowDet:f32;
// One thread per triangle of the drawn rows. The survivors are appended to a list whose order the
// image cannot see: both raster passes resolve their pixels with a minimum, which is commutative.
@compute @workgroup_size(64) fn bin(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let row=pageRow(group);
 let live=row<uni.pageCount;
 if(live&&lane.x==0u){let page=pages[row];rowVp=pageTransform(page);rowDet=pageWinding(page);}
 workgroupBarrier();
 if(!live){return;}
 let triangle=group.x*64u+lane.x;
 let t=setupTriangle(row,triangle,rowVp,rowDet);
 if(t.ok==0u){return;}
 let entry=(row<<8u)|(triangle&0xffu);
 // A box no wider than the fine grid is rasterised by ${FINE_SIDE * FINE_SIDE} lanes instead of 64, so the fine
 // class packs ${FINE_PER_GROUP} triangles into one workgroup. A pixel the smaller grid drops lies outside the
 // triangle's own bounding box, where the barycentric test rejects it anyway.
 if(t.span<=f32(${FINE_SIDE}u-1u)){atomicStore(&work[LIST+${LIST_HEADER}u+atomicAdd(&work[LIST],1u)],entry);}
 else{atomicStore(&work[LIST+${LIST_HEADER + capacity}u-1u-atomicAdd(&work[LIST+1u],1u)],entry);}
}
/** Turns each class count into its raster dispatch, so no count travels through the CPU. */
@compute @workgroup_size(1) fn plan(){
 let fine=(atomicLoad(&work[LIST])+${FINE_PER_GROUP}u-1u)/${FINE_PER_GROUP}u;
 atomicStore(&work[LIST+2u],min(fine,${DISPATCH_SPAN}u));
 atomicStore(&work[LIST+3u],(fine+${DISPATCH_SPAN}u-1u)/${DISPATCH_SPAN}u);
 atomicStore(&work[LIST+4u],1u);
 let coarse=atomicLoad(&work[LIST+1u]);
 atomicStore(&work[LIST+5u],min(coarse,${DISPATCH_SPAN}u));
 atomicStore(&work[LIST+6u],(coarse+${DISPATCH_SPAN}u-1u)/${DISPATCH_SPAN}u);
 atomicStore(&work[LIST+7u],1u);
}
fn smallAt(group:vec3u)->u32{return group.x+group.y*${DISPATCH_SPAN}u;}
// A workgroup is always 64 lanes, whatever the class: the coarse one spends them on the eight-by-eight
// box of a single triangle, the fine one on ${FINE_PER_GROUP} triangles of ${FINE_SIDE}×${FINE_SIDE} pixels each. A triangle is
// set up once for the lanes that share it instead of once per lane; those lanes then read the same
// values a per-lane setup would have produced.
var<workgroup> shared_tri:array<Tri,${FINE_PER_GROUP}u>;
fn fineGroup(group:vec3u,lane:vec3u,writeId:bool){
 let index=lane.y*8u+lane.x;
 let slot=index/${FINE_SIDE * FINE_SIDE}u;
 let i=smallAt(group)*${FINE_PER_GROUP}u+slot;
 if(index%${FINE_SIDE * FINE_SIDE}u==0u){
  var t:Tri;t.ok=0u;
  if(i<atomicLoad(&work[LIST])){let entry=atomicLoad(&work[LIST+${LIST_HEADER}u+i]);let page=pages[entry>>8u];t=setupTriangle(entry>>8u,entry&0xffu,pageTransform(page),pageWinding(page));}
  shared_tri[slot]=t;
 }
 workgroupBarrier();
 let t=shared_tri[slot];
 if(t.ok==0u){return;}
 let pixel=index%${FINE_SIDE * FINE_SIDE}u;
 rasterPixel(t,vec2u(pixel%${FINE_SIDE}u,pixel/${FINE_SIDE}u),writeId);
}
fn coarseGroup(group:vec3u,lane:vec3u,writeId:bool){
 let i=smallAt(group);
 if(lane.x==0u&&lane.y==0u){
  var t:Tri;t.ok=0u;
  if(i<atomicLoad(&work[LIST+1u])){let entry=atomicLoad(&work[LIST+${LIST_HEADER + capacity}u-1u-i]);let page=pages[entry>>8u];t=setupTriangle(entry>>8u,entry&0xffu,pageTransform(page),pageWinding(page));}
  shared_tri[0]=t;
 }
 workgroupBarrier();
 let t=shared_tri[0];
 if(t.ok==0u){return;}
 rasterPixel(t,lane.xy,writeId);
}
@compute @workgroup_size(8,8) fn fineDepth(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){fineGroup(group,lane,false);}
@compute @workgroup_size(8,8) fn fineId(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){fineGroup(group,lane,true);}
@compute @workgroup_size(8,8) fn coarseDepth(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){coarseGroup(group,lane,false);}
@compute @workgroup_size(8,8) fn coarseId(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){coarseGroup(group,lane,true);}`;
export const RESOLVE = `struct Uniforms{viewProj:mat4x4f,viewport:vec2f,smallThreshold:f32,pageCount:u32,drawSlot:u32,indirect:u32,selectionOffset:u32,selectionEnabled:u32,}
@group(0) @binding(0) var<storage,read> frame:array<u32>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}
struct One{@location(0) id:u32,@builtin(frag_depth) depth:f32,}
struct Two{@location(0) id:u32,@location(1) hiz:f32,@builtin(frag_depth) depth:f32,}
fn offset(pos:vec4f)->u32{return u32(pos.y)*u32(uni.viewport.x)+u32(pos.x);}
fn pixelCount()->u32{return u32(uni.viewport.x)*u32(uni.viewport.y);}
@fragment fn one(@builtin(position) pos:vec4f)->One{let i=offset(pos);let id=frame[pixelCount()+i];if(id==0xffffffffu){discard;}return One(id,bitcast<f32>(frame[i]));}
@fragment fn two(@builtin(position) pos:vec4f)->Two{let i=offset(pos);let id=frame[pixelCount()+i];if(id==0xffffffffu){discard;}let depth=bitcast<f32>(frame[i]);return Two(id,depth,depth);}`;
