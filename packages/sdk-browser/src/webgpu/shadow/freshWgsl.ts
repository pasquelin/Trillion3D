import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { CONE_MODEL_WGSL } from '../../../../sdk-core/src/scene/light-shadow/coneModelWgsl.ts';
import { pageModelWgsl } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import { SHADOW_PAGE, SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { CASTERS_ALL, SHADOW_CULL_GROUP } from '../../gpu/shadow/cullShader.ts';
import { SHADOW_PLACE_WGSL } from '../../lighting/direct/shadowSampleWgsl.ts';
import { SHADOW_DATA_WGSL } from '../../lighting/direct/shadowWgsl.ts';
import { shadowPoolWgsl } from './poolWgsl.ts';
import { FRESH_CASTERS, FRESH_CLEAR, FRESH_MOVING, FRESH_STILL } from './freshLayout.ts';
import { FRESH_FACE_WORDS, MAX_POOL_LAYERS } from './freshLayout.ts';
import { FRESH_LAYOUT_WGSL, FRESH_PARAMS_WGSL } from './freshLayoutWgsl.ts';
import { FRESH_LANES } from './freshLanes.ts';
/** Regions a frame's pair cull dispatches at most: a dispatch's second dimension. */
const MAX_FRESH_REGIONS = 65535;

/**
 * THE PAGES THE GPU DRAWS ITSELF (#1275), in the frame that maps them. The allocation lists every
 * page it maps, or mapped before and saw no draw of since, and the host's words every page they
 * take the depth of while the frame reads it (`listDraw`); once those are in, one workgroup
 * composes EVERY listed page into a region — its view (`ShadowView`: projection, place in the
 * pool, emitter, clip square), its cull volume —, the regions of each pool layer together, and the
 * arguments of what follows (`freshLayout.ts`): the pair cull over every caster row
 * (`freshCullWgsl.ts`), then `sealShadowPages`, then each layer's clear and caster draws.
 *
 * A page is claimed once (`DRAWN_GPU`) and composed by the page view model, as the host composes it
 * (`pageViewModel.ts`): a lamp page is its face's clip cropped to it, its cone the lamp's; a sun
 * page is its view cropped by the orthography, its box the square by the range's depth. Every
 * listed page is picked (`pickPages`), as the reference engine's virtual shadow maps draw every page a frame
 * marks in that frame (#1363): a receiver reads the level it asked for, never the coarser one. The
 * pair list holds the pool's fixed pairs (`pairGrowth.ts`, #831); a region past the longest prefix
 * it holds whole is left short (`FRESH_SHORT`, `admitShadowPairs`) and the seal makes readable the
 * others alone — never a page short of a caster —; a short one waits, listed again, for the next
 * frame or for the host. The
 * window is the session's (`referenceMode.ts`), the ordinary constant by default.
 */
export const shadowFreshWgsl = (pages = SUN_WINDOW) => `
${SHADOW_DATA_WGSL}
@group(0) @binding(0) var<storage,read_write> shadows:ShadowData;
@group(0) @binding(1) var<storage,read_write> shadowPool:ShadowPool;
@group(0) @binding(2) var<storage,read_write> drawList:array<u32>;
@group(0) @binding(3) var<storage,read_write> faces:array<u32>;
@group(0) @binding(4) var<storage,read_write> volumes:array<u32>;
@group(0) @binding(5) var<storage,read_write> args:array<u32>;
${FRESH_PARAMS_WGSL}
@group(0) @binding(6) var<storage,read> params:ShadowFreshParams;
@group(0) @binding(7) var<storage,read_write> dispatch:array<u32,3>;
${pageModelWgsl(pages)}
${CONE_MODEL_WGSL}
${shadowPoolWgsl(pages)}
${SHADOW_PLACE_WGSL}
${FRESH_LAYOUT_WGSL}
const FRESH_LANES:u32=${FRESH_LANES}u;
const FACE_WORDS:u32=${FRESH_FACE_WORDS}u;
const CULL_WORDS:u32=${SHADOW_CULL_FLOATS}u;
const CULL_GROUP:u32=${SHADOW_CULL_GROUP}u;
const PAGE_TEXELS:f32=${SHADOW_PAGE}.0;
const MAX_REGIONS:u32=${MAX_FRESH_REGIONS}u;
var<workgroup> layerCount:array<u32,${MAX_POOL_LAYERS}>;
var<workgroup> regionCount:u32;
fn shadowPoolPages()->u32{return params.pages;}
fn poolLayer(p:u32)->u32{return u32(shadowPoolPlace(f32(p),f32(params.side)).z);}
fn faceF(i:u32,v:f32){faces[i]=bitcast<u32>(v);}
fn volumeF(i:u32,v:f32){volumes[i]=bitcast<u32>(v);}
fn faceVec(i:u32,v:vec4f){faceF(i,v.x);faceF(i+1u,v.y);faceF(i+2u,v.z);faceF(i+3u,v.w);}
fn volumeVec(i:u32,v:vec4f){volumeF(i,v.x);volumeF(i+1u,v.y);volumeF(i+2u,v.z);volumeF(i+3u,v.w);}
/** Lane 0: the listed pages still waiting for a draw, each claimed once, then laid out as regions
 *  layer after layer (\`FRESH_LAYER_STARTS\`, \`FRESH_REGION_PAGES\`): every one of them, as many as
 *  the cull's dispatch holds. */
fn pickPages(){
 for(var l=0u;l<params.layers;l++){layerCount[l]=0u;}
 let listed=min(countRead(COUNT_DRAWN),params.pages);
 var picked=0u;
 for(var i=0u;i<listed&&picked<MAX_REGIONS;i++){
  let p=drawList[i];let e=shadowPool.pages[poolAt(POOL_OWNER,p)];
  if(e<0){continue;}
  let word=shadows.table[u32(e)];let by=poolAt(POOL_DRAWNBY,p);
  if((word&(PAGE_MAPPED|PAGE_VALID))!=PAGE_MAPPED||(word&PAGE_INDEX_MASK)!=p||shadowPool.pages[by]!=DRAWN_NONE){continue;}
  shadowPool.pages[by]=DRAWN_GPU;drawList[picked]=p;picked++;
  layerCount[poolLayer(p)]+=1u;
 }
 var start=0u;
 for(var l=0u;l<params.layers;l++){args[FRESH_LAYER_STARTS+l]=start;start+=layerCount[l];layerCount[l]=0u;}
 for(var i=0u;i<picked;i++){
  let p=drawList[i];let l=poolLayer(p);
  args[FRESH_REGION_PAGES+args[FRESH_LAYER_STARTS+l]+layerCount[l]]=p;layerCount[l]+=1u;
 }
 regionCount=picked;
}
/** Clip column \`c\` of a view cropped on x and y (\`shadowCropped\`), its depth by \`zs, zo\`. */
fn cropped(c:vec4f,a:f32,b:f32,cy:f32,d:f32,zs:f32,zo:f32)->vec4f{
 return vec4f(shadowCropped(c.x,c.w,a,b),shadowCropped(c.y,c.w,cy,d),shadowCropped(c.z,c.w,zs,zo),c.w);
}
/** \`p\` moved by \`s\` along \`d\` (\`shadowAlong\`). */
fn along3(p:vec3f,d:vec3f,s:f32)->vec3f{return vec3f(shadowAlong(p.x,d.x,s),shadowAlong(p.y,d.y,s),shadowAlong(p.z,d.z,s));}
/** A sun page: its view from the eye on the near side of the range at the square's centre, cropped
 *  by the orthography; its box, the square by the range's depth; its texels per metre (#831). */
fn composeSun(k:u32,slice:u32,level:i32,x:f32,y:f32){
 let frame=shadows.records[slice].frame;
 let r=frame[0].xyz;let u=frame[1].xyz;let f=frame[2].xyz;let zNear=frame[0].w;let far=frame[1].w-zNear;
 let metres=shadowSunTexelMetres(level)*PAGE_TEXELS;let h=metres*0.5;
 let cx=shadowSunSquareCentre(x,1.0,metres);let cy=-shadowSunSquareCentre(y,1.0,metres);
 let eye=vec3f(shadowSunEye(r.x,u.x,f.x,cx,cy,zNear),shadowSunEye(r.y,u.y,f.y,cx,cy,zNear),shadowSunEye(r.z,u.z,f.z,cx,cy,zNear));
 let s=shadowOrthoScale(h);let zs=shadowOrthoDepthScale(far);let zo=shadowOrthoDepthOffset(far);
 let at=k*FACE_WORDS;
 faceVec(at,cropped(vec4f(r.x,u.x,-f.x,0.0),s,0.0,s,0.0,zs,zo));
 faceVec(at+4u,cropped(vec4f(r.y,u.y,-f.y,0.0),s,0.0,s,0.0,zs,zo));
 faceVec(at+8u,cropped(vec4f(r.z,u.z,-f.z,0.0),s,0.0,s,0.0,zs,zo));
 faceVec(at+12u,cropped(vec4f(-dot(r,eye),-dot(u,eye),dot(f,eye),1.0),s,0.0,s,0.0,zs,zo));
 let mid=shadowBoxMid(-1.0,1.0,h);let half=shadowBoxHalf(-1.0,1.0,h);
 let v=k*CULL_WORDS;
 volumeVec(v,vec4f(along3(along3(along3(eye,f,far*0.5),r,mid),u,mid),far*0.5));volumeVec(v+4u,vec4f(f,-1.0));
 volumeVec(v+8u,vec4f(r,half));volumeVec(v+12u,vec4f(u,half));volumeF(v+18u,1.0/shadowSunTexelMetres(level));
}
/** A lamp page: its face's clip cropped to the page; its cone the host's (\`coneModel.ts\`); its
 *  texels per unit of the face's tangent, its focal (#831). */
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
 faceVec(at,cropped(c0,a,b,c,d,1.0,0.0));faceVec(at+4u,cropped(c1,a,b,c,d,1.0,0.0));
 faceVec(at+8u,cropped(c2,a,b,c,d,1.0,0.0));faceVec(at+12u,cropped(c3,a,b,c,d,1.0,0.0));
 let r=normalize(vec3f(c0.x,c1.x,c2.x));let u=normalize(vec3f(c0.y,c1.y,c2.y));
 let f=normalize(vec3f(c0.w,c1.w,c2.w));let t=shadows.records[slice].info.y;
 let halfFov=atan(t);let axis=shadowConeAxis(f,r,u,t,halfFov,u0,u1,v0,v1);
 let s=params.slices[slice];let w=k*CULL_WORDS;
 volumeVec(w,vec4f(s.emitter.xyz,s.far.x));volumeVec(w+4u,vec4f(axis,shadowConeSpread(f,r,u,t,halfFov,axis,u0,u1,v0,v1)));
 volumeVec(w+8u,vec4f(0.0));volumeVec(w+12u,vec4f(0.0));volumeF(w+18u,pages*PAGE_TEXELS/(2.0*t));
}
/** Region \`k\`: its page's view and volume, every caster of it kept (\`CASTERS_ALL\`), no pair
 *  counted yet. */
fn composeRegion(k:u32){
 args[freshRegionPairs(params.pages,k)]=0u;
 let p=args[FRESH_REGION_PAGES+k];let e=u32(shadowPool.pages[poolAt(POOL_OWNER,p)]);let slice=e/SHADOW_TABLE_STRIDE;
 let place=shadowPoolPlace(f32(p),f32(params.side))*PAGE_TEXELS;let size=f32(params.side)*PAGE_TEXELS;
 let at=k*FACE_WORDS;
 faceVec(at+16u,vec4f(place.xy/size,PAGE_TEXELS/size,PAGE_TEXELS));
 faceVec(at+20u,params.slices[slice].emitter);
 faceVec(at+24u,vec4f(shadowAtlasClip(place.x,size),-shadowAtlasClip(place.y,size),vec2f(PAGE_TEXELS/size)));
 let x=f32(shadowPool.pages[poolAt(POOL_X,p)]);let y=f32(shadowPool.pages[poolAt(POOL_Y,p)]);
 if(u32(shadows.records[slice].info.x)==u32(SUN_LEVEL_COUNT)){composeSun(k,slice,shadowPool.pages[poolAt(POOL_VIEW,p)],x,y);}
 else{composeLamp(k,slice,shadowPool.pages[poolAt(POOL_VIEW,p)],x,y);}
 volumes[k*CULL_WORDS+16u]=${CASTERS_ALL}u;volumes[k*CULL_WORDS+17u]=0u;
}
@compute @workgroup_size(${FRESH_LANES}) fn composeShadowPages(@builtin(local_invocation_index) lane:u32){
 if(lane==0u){pickPages();}
 // Lane 0's storage writes — the regions' pages, the claims — seen by every lane before they read.
 storageBarrier();
 let regions=workgroupUniformLoad(&regionCount);
 for(var k=lane;k<regions;k+=FRESH_LANES){composeRegion(k);}
 if(lane<params.layers){
  let clear=freshDraw(lane,${FRESH_CLEAR}u);
  args[clear]=6u;args[clear+1u]=layerCount[lane];args[clear+2u]=lane<<FRESH_LAYER_SHIFT;args[clear+3u]=0u;
  for(var kind=${FRESH_CASTERS}u;kind<=${FRESH_MOVING}u;kind++){
   let casters=freshDraw(lane,kind);
   args[casters]=0u;args[casters+1u]=0u;args[casters+2u]=lane<<FRESH_LAYER_SHIFT;args[casters+3u]=0u;
  }
 }
 if(lane==0u){
  let rows=params.rows+params.blendEnd-params.blendFirst;
  dispatch[0]=select((rows+CULL_GROUP-1u)/CULL_GROUP,0u,regions==0u);dispatch[1]=regions;dispatch[2]=1u;
  args[FRESH_REGIONS]=regions;args[FRESH_CORNERS]=0u;
  args[FRESH_STILL_PAIRS]=0u;args[FRESH_MOVING_PAIRS]=0u;args[FRESH_LAST_PAIR]=params.capacity-1u;
 }
}
/** After the pair cull: each region admitted whole is readable — in the sun's current
 *  range —; one left short (\`FRESH_SHORT\`) is not, and waits unclaimed for the next
 *  frame's pick. Each layer draws the pairs kept — all, the still, the moving —; the pairs every region counted go to the pool's
 *  counts, a diagnostic: the list is fixed by the pool (\`pairRows.ts\`). */
@compute @workgroup_size(${FRESH_LANES}) fn sealShadowPages(@builtin(local_invocation_index) lane:u32){
 let regions=args[FRESH_REGIONS];
 for(var k=lane;k<regions;k+=FRESH_LANES){
  let p=args[FRESH_REGION_PAGES+k];
  if(args[freshRegionPairs(params.pages,k)]==FRESH_SHORT){shadowPool.pages[poolAt(POOL_DRAWNBY,p)]=DRAWN_NONE;}
  else{
   let e=u32(shadowPool.pages[poolAt(POOL_OWNER,p)]);let slice=e/SHADOW_TABLE_STRIDE;
   var range=0u;
   if(u32(shadows.records[slice].info.x)==u32(SUN_LEVEL_COUNT)){range=u32(shadows.records[slice].frame[2].w);}
   shadows.table[e]=shadowReadableWord(p,range);
  }
 }
 if(lane<params.layers){
  // Every kept caster, the still ones from the list's start, the moving ones from its end down.
  let still=args[FRESH_STILL_PAIRS];let moving=args[FRESH_MOVING_PAIRS];
  let kept=freshDraw(lane,${FRESH_CASTERS}u);let first=freshDraw(lane,${FRESH_STILL}u);let last=freshDraw(lane,${FRESH_MOVING}u);
  args[kept]=args[FRESH_CORNERS];args[kept+1u]=still+moving;
  args[first]=args[FRESH_CORNERS];args[first+1u]=still;
  args[last]=args[FRESH_CORNERS];args[last+1u]=moving;
 }
 if(lane==0u){countSet(COUNT_PAIRS,args[FRESH_NEED]);}
}`;
