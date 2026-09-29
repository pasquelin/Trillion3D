import { MAX_SHADOW_SLICES, SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import {
  SHADOW_CULL_CASTERS,
  SHADOW_CULL_VIEW,
} from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { PAGE_MODEL_WGSL } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import {
  LAYER_PAGES,
  PAGE_INDEX_MASK,
  PAGE_RANGE_SHIFT,
  SHADOW_PAGE,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { DRAW_INDIRECT_WORDS } from '../../gpu/draw/contract.ts';
import { SHADOW_FACE_STRIDE, SHADOW_REGION_COMMANDS } from '../../gpu/shadow/batchBudget.ts';
import { CASTERS_ALL, SHADOW_CULL_GROUP } from '../../gpu/shadow/cullShader.ts';
import { MAX_SHADOW_REGIONS, SHADOW_FACE_READ_WORDS } from '../../gpu/shadow/recordPack.ts';
import { SHADOW_PLACE_WGSL } from '../../lighting/direct/shadowSampleWgsl.ts';
import { SHADOW_DATA_WGSL } from '../../lighting/direct/shadowWgsl.ts';
import { POOL_COUNTS, SHADOW_POOL_WGSL } from './poolWgsl.ts';

/** Invocations of the one workgroup that composes a frame's GPU-drawn pages. */
export const FRESH_LANES = 64;
/** Layers a pool holds at most: a table word names 2¹⁶ pages (`shadowPoolShape`). */
export const MAX_POOL_LAYERS = (PAGE_INDEX_MASK + 1) / LAYER_PAGES;
/** Words of the parameters before the slices: pages, layer side, layers, regions a layer, rows. */
export const FRESH_PARAM_WORDS = 8;
/** Floats of a slice's parameters: its emitter — centre and envelope radius —, its far plane. */
export const FRESH_SLICE_FLOATS = 8;
/** Words of a layer's dispatch arguments for the cull. */
export const FRESH_ARG_WORDS = 3;

/**
 * THE PAGES THE GPU DRAWS ITSELF (#1275), in the frame that maps them: the allocation lists every
 * page it mapped, or mapped before and saw no draw of since (`allocWgsl.ts`, `listDraw`), and once
 * the host's pages are drawn and its table words applied, one workgroup composes each of them into
 * a region of the batch buffers — its face (\`ShadowView\`: the page's projection, its place in the
 * pool, its emitter, its clip square in the layer's), its cull volume, its commands at zero —, the
 * region count of each layer as the cull's dispatch, and its word written readable: the cull and
 * the draws that follow land before anything reads it (`freshPass.ts`).
 *
 * A page is one region, all its casters at once; layer `l` holds regions `[l · perLayer, …)`, the
 * first listed first. A page whose word the host's draws made readable meanwhile is the host's; one
 * past its layer's regions waits for the next frame's list. The projection is composed from the
 * light's record by the page model (`pageModel.ts`), as the host composes it (`writeLampPage`,
 * `writeSunSquare`); the volume is the page's own in light space — a lamp page's cone, a sun page's
 * box —, whatever the camera sees.
 */
export const SHADOW_FRESH_WGSL = `
${SHADOW_DATA_WGSL}
@group(0) @binding(0) var<storage,read_write> shadows:ShadowData;
struct ShadowFreshPool{counts:array<u32,${POOL_COUNTS.length}>,pages:array<i32>,}
@group(0) @binding(1) var<storage,read_write> shadowPool:ShadowFreshPool;
@group(0) @binding(2) var<storage,read> drawList:array<u32>;
@group(0) @binding(3) var<storage,read_write> faces:array<u32>;
@group(0) @binding(4) var<storage,read_write> volumes:array<u32>;
@group(0) @binding(5) var<storage,read_write> commands:array<u32>;
struct ShadowFreshSlice{emitter:vec4f,far:vec4f,}
struct ShadowFreshParams{pages:u32,side:u32,layers:u32,perLayer:u32,rows:u32,pad0:u32,pad1:u32,pad2:u32,slices:array<ShadowFreshSlice,${MAX_SHADOW_SLICES}>,}
@group(0) @binding(6) var<storage,read> params:ShadowFreshParams;
@group(0) @binding(7) var<storage,read_write> args:array<u32>;
${PAGE_MODEL_WGSL}
${SHADOW_POOL_WGSL}
${SHADOW_PLACE_WGSL}
const FRESH_LANES:u32=${FRESH_LANES}u;
const FRESH_REGIONS:u32=${MAX_SHADOW_REGIONS}u;
const FACE_WORDS:u32=${SHADOW_FACE_STRIDE / 4}u;
const RECT_WORD:u32=${SHADOW_FACE_READ_WORDS}u;
const ORDER_WORD:u32=${(MAX_SHADOW_REGIONS * SHADOW_FACE_STRIDE) / 4}u;
const CULL_WORDS:u32=${SHADOW_CULL_FLOATS}u;
const REGION_WORDS:u32=${SHADOW_REGION_COMMANDS * DRAW_INDIRECT_WORDS}u;
const CULL_GROUP:u32=${SHADOW_CULL_GROUP}u;
const PAGE_TEXELS:f32=${SHADOW_PAGE}.0;
const RANGE_SHIFT:u32=${PAGE_RANGE_SHIFT}u;
var<workgroup> regionPage:array<i32,${MAX_SHADOW_REGIONS}>;
var<workgroup> layerCount:array<u32,${MAX_POOL_LAYERS}>;
fn poolField(field:u32,p:u32)->i32{return shadowPool.pages[field*params.pages+p];}
fn faceF(i:u32,v:f32){faces[i]=bitcast<u32>(v);}
fn volumeF(i:u32,v:f32){volumes[i]=bitcast<u32>(v);}
fn faceVec(i:u32,v:vec4f){faceF(i,v.x);faceF(i+1u,v.y);faceF(i+2u,v.z);faceF(i+3u,v.w);}
fn volumeVec(i:u32,v:vec4f){volumeF(i,v.x);volumeF(i+1u,v.y);volumeF(i+2u,v.z);volumeF(i+3u,v.w);}
/** Lane 0: the listed pages each layer draws, in list order, while the host has not drawn them. */
fn pickPages(){
 for(var l=0u;l<params.layers;l++){layerCount[l]=0u;}
 for(var k=0u;k<FRESH_REGIONS;k++){regionPage[k]=-1;}
 let listed=min(shadowPool.counts[COUNT_DRAWN],params.pages);
 var open=params.layers;
 for(var i=0u;i<listed&&open>0u;i++){
  let p=drawList[i];let e=poolField(POOL_OWNER,p);
  if(e<0){continue;}
  let word=shadows.table[u32(e)];
  if((word&(PAGE_MAPPED|PAGE_VALID))!=PAGE_MAPPED||(word&PAGE_INDEX_MASK)!=p){continue;}
  let l=u32(shadowPoolPlace(f32(p),f32(params.side)).z);let k=layerCount[l];
  if(k>=params.perLayer){continue;}
  regionPage[l*params.perLayer+k]=i32(p);layerCount[l]=k+1u;
  if(k+1u==params.perLayer){open=open-1u;}
 }
}
/** A sun page's orthography — its eye at the square's centre on the near side of the range —, and
 *  its box: the square by the range's depth. */
fn composeSun(k:u32,slice:u32,level:i32,x:f32,y:f32){
 let frame=shadows.records[slice].frame;
 let metres=shadowSunTexelMetres(level)*PAGE_TEXELS;let half=metres*0.5;
 let right=frame[0].xyz;let up=frame[1].xyz;let axis=frame[2].xyz;
 let zNear=frame[0].w;let far=frame[1].w-zNear;
 let eye=right*shadowSunSquareCentre(x,1.0,metres)-up*shadowSunSquareCentre(y,1.0,metres)+axis*zNear;
 let at=k*FACE_WORDS;
 faceVec(at,vec4f(right.x/half,up.x/half,-axis.x/far,0.0));
 faceVec(at+4u,vec4f(right.y/half,up.y/half,-axis.y/far,0.0));
 faceVec(at+8u,vec4f(right.z/half,up.z/half,-axis.z/far,0.0));
 faceVec(at+12u,vec4f(-dot(right,eye)/half,-dot(up,eye)/half,dot(axis,eye)/far+1.0,1.0));
 let v=k*CULL_WORDS;
 volumeVec(v,vec4f(eye+axis*(far*0.5),far*0.5));volumeVec(v+4u,vec4f(axis,-1.0));
 volumeVec(v+8u,vec4f(right,half));volumeVec(v+12u,vec4f(up,half));
}
fn crop(c:vec4f,a:f32,b:f32,cy:f32,d:f32)->vec4f{return vec4f(a*c.x+b*c.w,cy*c.y+d*c.w,c.z,c.w);}
fn coneDirection(forward:vec3f,right:vec3f,up:vec3f,t:f32,u:f32,v:f32)->vec3f{return normalize(forward+t*(u*right+v*up));}
/** A lamp page's projection — its face's, cropped to the page — and its cone: the lamp as apex,
 *  the page's centre as axis, its farthest corner as half-angle (\`writeConeVolume\`). */
fn composeLamp(k:u32,slice:u32,view:i32,x:f32,y:f32){
 let m=shadows.records[slice].faces[view>>4u];
 let pages=f32(LAMP_PAGE_COUNT>>u32(view&15));
 let u0=shadowRegionLow(pages,x);let u1=shadowRegionHigh(pages,x);
 let v0=-shadowRegionHigh(pages,y);let v1=-shadowRegionLow(pages,y);
 let a=shadowCropScale(u0,u1);let b=shadowCropOffset(u0,u1);
 let c=shadowCropScale(v0,v1);let d=shadowCropOffset(v0,v1);
 let c0=m*vec4f(1.0,0.0,0.0,0.0);let c1=m*vec4f(0.0,1.0,0.0,0.0);
 let c2=m*vec4f(0.0,0.0,1.0,0.0);let c3=m*vec4f(0.0,0.0,0.0,1.0);
 let at=k*FACE_WORDS;
 faceVec(at,crop(c0,a,b,c,d));faceVec(at+4u,crop(c1,a,b,c,d));
 faceVec(at+8u,crop(c2,a,b,c,d));faceVec(at+12u,crop(c3,a,b,c,d));
 let right=normalize(vec3f(c0.x,c1.x,c2.x));let up=normalize(vec3f(c0.y,c1.y,c2.y));
 let forward=normalize(vec3f(c0.w,c1.w,c2.w));let t=shadows.records[slice].info.y;
 let axis=coneDirection(forward,right,up,t,(u0+u1)*0.5,(v0+v1)*0.5);
 // The angle to the farthest corner from its chord, exact in f32 where an arccosine near 1 is not.
 var chord=0.0;
 for(var corner=0u;corner<4u;corner++){
  let u=select(u0,u1,(corner&1u)!=0u);let v=select(v0,v1,(corner&2u)!=0u);
  chord=max(chord,length(coneDirection(forward,right,up,t,u,v)-axis));
 }
 let s=params.slices[slice];let w=k*CULL_WORDS;
 volumeVec(w,vec4f(s.emitter.xyz,s.far.x));volumeVec(w+4u,vec4f(axis,2.0*asin(min(chord*0.5,1.0))));
}
/** Region \`k\`: its commands at zero, its place in the pass order, and its page's face, volume and
 *  word — or, without a page, a clip square of no area, which the page quads clear nothing with. */
fn composeRegion(k:u32){
 for(var w=0u;w<REGION_WORDS;w++){commands[k*REGION_WORDS+w]=0u;}
 faces[ORDER_WORD+k]=k;
 let at=k*FACE_WORDS;let page=regionPage[k];
 if(page<0){faceVec(at+RECT_WORD,vec4f(0.0));return;}
 let p=u32(page);let e=u32(poolField(POOL_OWNER,p));let slice=e/SHADOW_TABLE_STRIDE;
 let place=shadowPoolPlace(f32(p),f32(params.side))*PAGE_TEXELS;let size=f32(params.side)*PAGE_TEXELS;
 faceVec(at+16u,vec4f(place.xy/size,PAGE_TEXELS/size,PAGE_TEXELS));
 faceVec(at+20u,params.slices[slice].emitter);
 faceVec(at+RECT_WORD,vec4f(shadowAtlasClip(place.x,size),-shadowAtlasClip(place.y,size),vec2f(PAGE_TEXELS/size)));
 let info=shadows.records[slice].info;let x=f32(poolField(POOL_X,p));let y=f32(poolField(POOL_Y,p));
 var range=0u;
 if(u32(info.x)==u32(SUN_LEVEL_COUNT)){
  range=u32(shadows.records[slice].frame[2].w);composeSun(k,slice,poolField(POOL_VIEW,p),x,y);
 }else{composeLamp(k,slice,poolField(POOL_VIEW,p),x,y);}
 volumes[k*CULL_WORDS+${SHADOW_CULL_CASTERS}u]=${CASTERS_ALL}u;volumes[k*CULL_WORDS+${SHADOW_CULL_VIEW}u]=0u;
 shadows.table[e]=p|PAGE_MAPPED|PAGE_VALID|(range<<RANGE_SHIFT);
 shadowPool.pages[POOL_DRAWNBY*params.pages+p]=DRAWN_GPU;
}
@compute @workgroup_size(${FRESH_LANES}) fn composeShadowPages(@builtin(local_invocation_index) lane:u32){
 if(lane==0u){pickPages();}
 workgroupBarrier();
 for(var k=lane;k<FRESH_REGIONS;k+=FRESH_LANES){composeRegion(k);}
 if(lane<params.layers){
  let groups=(params.rows+CULL_GROUP-1u)/CULL_GROUP;
  args[lane*${FRESH_ARG_WORDS}u]=select(groups,0u,layerCount[lane]==0u);
  args[lane*${FRESH_ARG_WORDS}u+1u]=layerCount[lane];args[lane*${FRESH_ARG_WORDS}u+2u]=1u;
 }
}`;
