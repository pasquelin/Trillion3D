import {HIZ_BACKGROUND,hizBuildPyramid,hizFootprintFar,hizOccluded} from '../sdk-core/index.ts';
import {rasterVisibility,unpackVisibilityId,type VisPage} from './visibilityBuffer.ts';
import * as THREE from 'three';

export type HizPage={min:number[];max:number[];matrix:THREE.Matrix4;url?:string;clusterId?:string};
export type HizBounds={minX:number;minY:number;maxX:number;maxY:number;nearestDepth:number;clipsNear:boolean};
export type HizPyramid={levels:number[][][];width:number;height:number};

const projectScratch=new THREE.Vector3();
const viewProjScratch=new THREE.Matrix4();

export {HIZ_BACKGROUND};

function rowsOf(depth:Float32Array,width:number,height:number){
 const rows:number[][]=[];
 for(let y=0;y<height;y++){
  const row=new Array<number>(width);
  for(let x=0;x<width;x++)row[x]=depth[y*width+x];
  rows.push(row);
 }
 return rows;
}
/** Standard Hi-Z pyramid from visbuffer depth (background 1, max reduction). */
export function buildHizPyramid(depth:Float32Array,width:number,height:number):HizPyramid{
 if(width<1||height<1||depth.length<width*height)throw new Error('HIZ_DEPTH_SIZE');
 return {levels:hizBuildPyramid(rowsOf(depth,width,height)),width,height};
}

function projectVertex(matrix:THREE.Matrix4,position:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,vi:number,viewProj:THREE.Matrix4,width:number,height:number){
 const v=projectScratch.set(position.getX(vi),position.getY(vi),position.getZ(vi)).applyMatrix4(matrix);
 const e=viewProj.elements;
 const cx=e[0]*v.x+e[4]*v.y+e[8]*v.z+e[12],cy=e[1]*v.x+e[5]*v.y+e[9]*v.z+e[13],cz=e[2]*v.x+e[6]*v.y+e[10]*v.z+e[14],cw=e[3]*v.x+e[7]*v.y+e[11]*v.z+e[15];
 if(cw===0||!Number.isFinite(cw))return null;
 const ndcX=cx/cw,ndcY=cy/cw,ndcZ=cz/cw;
 return {x:(ndcX*0.5+0.5)*width,y:(1-(ndcY*0.5+0.5))*height,z:ndcZ*0.5+0.5};
}

/** NDC z of the visbuffer winner. Background pixels stay 1. */
export function visibilityDepth(ids:Uint32Array,pages:VisPage[],camera:THREE.PerspectiveCamera,viewport:[number,number]){
 const [width,height]=viewport,depth=new Float32Array(width*height);
 depth.fill(HIZ_BACKGROUND);
 camera.updateMatrixWorld();
 const viewProj=viewProjScratch.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const unpacked=unpackVisibilityId(ids[y*width+x]);if(!unpacked)continue;
  const page=pages[unpacked.pageIndex];if(!page?.attributes.position)continue;
  const index=page.array,base=unpacked.triangleIndex*3;
  if(base+2>=index.length)continue;
  const a=projectVertex(page.matrix,page.attributes.position,index[base],viewProj,width,height);
  const b=projectVertex(page.matrix,page.attributes.position,index[base+1],viewProj,width,height);
  const c=projectVertex(page.matrix,page.attributes.position,index[base+2],viewProj,width,height);
  if(!a||!b||!c)continue;
  const area=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);if(area===0)continue;
  const w0=((b.x-x)*(c.y-y)-(c.x-x)*(b.y-y))/area,w1=((c.x-x)*(a.y-y)-(a.x-x)*(c.y-y))/area,w2=1-w0-w1;
  if(w0<0||w1<0||w2<0)continue;
  const z=w0*a.z+w1*b.z+w2*c.z;
  if(!Number.isFinite(z))continue;
  depth[y*width+x]=z;
 }
 return depth;
}

/** Values per box in the flat bounds layout: minX,minY,maxX,maxY,nearestDepth,clipsNear. */
export const HIZ_BOUNDS_VALUES=6;

/** Doubles one box occupies in the world-corner layout: eight corners of three coordinates. */
const BOX_CORNER_VALUES=24;
/** The eight world-space corners of a local box, in the order the screen projection reads them. */
function worldCornersInto(min:readonly number[],max:readonly number[],world:THREE.Matrix4,into:Float64Array,base:number){
 const m=world.elements;
 for(let i=0;i<8;i++){
  const lx=i&1?max[0]:min[0],ly=i&2?max[1]:min[1],lz=i&4?max[2]:min[2];
  const mw=1/(m[3]*lx+m[7]*ly+m[11]*lz+m[15]);
  const at=base+i*3;
  into[at]=(m[0]*lx+m[4]*ly+m[8]*lz+m[12])*mw;
  into[at+1]=(m[1]*lx+m[5]*ly+m[9]*lz+m[13])*mw;
  into[at+2]=(m[2]*lx+m[6]*ly+m[10]*lz+m[14])*mw;
 }
}
/** Screen AABB of eight world-space corners. Term for term the arithmetic of the one-shot path. */
function projectCornersInto(corners:Float64Array,from:number,viewElements:ArrayLike<number>,viewProjElements:ArrayLike<number>,near:number,width:number,height:number,into:Float64Array,base:number){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,nearest=Infinity,clipsNear=false,projected=0;
 const v=viewElements,e=viewProjElements;
 for(let i=0;i<8;i++){
  const at=from+i*3,x=corners[at],y=corners[at+1],z=corners[at+2];
  const vw=1/(v[3]*x+v[7]*y+v[11]*z+v[15]);
  if(-((v[2]*x+v[6]*y+v[10]*z+v[14])*vw)<=near)clipsNear=true;
  const cw=e[3]*x+e[7]*y+e[11]*z+e[15];
  if(cw<=0||!Number.isFinite(cw)){clipsNear=true;continue;}
  const ndcX=(e[0]*x+e[4]*y+e[8]*z+e[12])/cw,ndcY=(e[1]*x+e[5]*y+e[9]*z+e[13])/cw,ndcZ=(e[2]*x+e[6]*y+e[10]*z+e[14])/cw;
  const sx=(ndcX*0.5+0.5)*width,sy=(1-(ndcY*0.5+0.5))*height,sz=ndcZ*0.5+0.5;
  if(sx<minX)minX=sx;if(sy<minY)minY=sy;if(sx>maxX)maxX=sx;if(sy>maxY)maxY=sy;
  if(sz<nearest)nearest=sz;
  projected++;
 }
 if(!projected||clipsNear){into[base]=0;into[base+1]=0;into[base+2]=0;into[base+3]=0;into[base+4]=0;into[base+5]=1;return;}
 into[base]=Math.floor(minX);into[base+1]=Math.floor(minY);into[base+2]=Math.ceil(maxX);into[base+3]=Math.ceil(maxY);into[base+4]=nearest;into[base+5]=0;
}
const cornerScratch=new Float64Array(BOX_CORNER_VALUES);
/**
 * Conservative screen AABB of one box into `into` at `base`. min/max are inclusive integer samples
 * (fillIds last pixel is ceil(max)). Near-plane crossings never reject. The caller passes the view
 * and view-projection elements, so a batch builds them once instead of once per box; the arithmetic
 * is `Matrix4`/`Vector3.applyMatrix4` term for term, so the flat and object forms agree bit for bit.
 */
function projectBoxInto(min:readonly number[],max:readonly number[],world:THREE.Matrix4,viewElements:ArrayLike<number>,viewProjElements:ArrayLike<number>,near:number,width:number,height:number,into:Float64Array,base:number){
 worldCornersInto(min,max,world,cornerScratch,0);
 projectCornersInto(cornerScratch,0,viewElements,viewProjElements,near,width,height,into,base);
}
/**
 * World-space corners kept per page from one image to the next. A corner changes only when the page's
 * world matrix does, and `epoch` is what names that: an image then pays the clip transform alone, not
 * the world transform of twenty thousand boxes it has already computed. The cached doubles are exactly
 * those the one-shot path computes, so the rectangles stay bit for bit the same.
 */
export function createBoxCorners(pageCount:number){
 const corners=new Float64Array(Math.max(1,pageCount)*BOX_CORNER_VALUES),epoch=new Int32Array(Math.max(1,pageCount));
 return {
  corners,epoch,
  /** Offset of `pageIndex`'s corners, recomputed when its epoch no longer matches. */
  at(pageIndex:number,page:HizPage,value:number){
   const base=pageIndex*BOX_CORNER_VALUES;
   if(epoch[pageIndex]!==value){worldCornersInto(page.min,page.max,page.matrix,corners,base);epoch[pageIndex]=value;}
   return base;
  },
 };
}
export type BoxCorners=ReturnType<typeof createBoxCorners>;

/**
 * Screen AABBs of `count` pages into `into`, with the view-projection built once for the batch rather
 * than once per page. Nothing is allocated: `into` holds `HIZ_BOUNDS_VALUES` per page and is the
 * caller's.
 */
export function projectBoxesFlat(pages:ArrayLike<HizPage|undefined>,count:number,camera:THREE.PerspectiveCamera,viewport:[number,number],into:Float64Array,only?:Uint8Array,world?:{corners:BoxCorners;pageIndex:Int32Array;epoch:number}){
 const [width,height]=viewport;
 camera.updateMatrixWorld();
 const viewProj=viewProjScratch.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 const view=camera.matrixWorldInverse.elements,elements=viewProj.elements,near=camera.near;
 for(let i=0;i<count;i++){
  if(only&&!only[i])continue;
  const page=pages[i];if(!page)continue;
  const base=i*HIZ_BOUNDS_VALUES;
  if(world)projectCornersInto(world.corners.corners,world.corners.at(world.pageIndex[i],page,world.epoch),view,elements,near,width,height,into,base);
  else projectBoxInto(page.min,page.max,page.matrix,view,elements,near,width,height,into,base);
 }
}

const boundsScratch=new Float64Array(HIZ_BOUNDS_VALUES);
/** Conservative screen AABB. min/max are inclusive integer samples (fillIds last pixel is ceil(max)). Near-plane crossings never reject. */
export function projectBoxToScreen(min:number[],max:number[],world:THREE.Matrix4,camera:THREE.PerspectiveCamera,viewport:[number,number]):HizBounds{
 camera.updateMatrixWorld();
 const viewProj=viewProjScratch.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 projectBoxInto(min,max,world,camera.matrixWorldInverse.elements,viewProj.elements,camera.near,viewport[0],viewport[1],boundsScratch,0);
 const b=boundsScratch;
 if(b[5]!==0)return {minX:0,minY:0,maxX:0,maxY:0,nearestDepth:0,clipsNear:true};
 return {minX:b[0],minY:b[1],maxX:b[2],maxY:b[3],nearestDepth:b[4],clipsNear:false};
}

/** Side of the test kernel, in texels of the mip it reads. A wider footprint answers from a coarser level. */
export const HIZ_KERNEL_TEXELS=16;

/**
 * Values `hizTestRectFlat` writes: the mip the box answers from, then the level-0 rectangle that mip
 * is read over, inclusive on both ends.
 */
export const HIZ_TEST_VALUES=5;

/**
 * The part of a screen rectangle that can ever paint a pixel, and the mip that covers it exactly.
 *
 * The rectangle is clipped to the viewport: what falls outside it reaches no pixel, so reading the
 * depth of the clipped part alone is what the box is actually competing against. That is strictly
 * safe — the depth the test compares is still the nearest corner of the *whole* box, which is no
 * farther than the nearest corner of its clipped part, so a box kept today is still kept. It is also
 * what makes a box straddling an edge testable at all: before clipping, any box reaching past the
 * viewport answered `undefined` and was never rejected, however deeply buried it was.
 *
 * The mip is the finest one whose outward-rounded footprint fits the test kernel, so the depth read
 * is the tightest the pyramid can give: a coarser mip would take the maximum over pixels the box does
 * not cover and reject less. Writes `into[0]` = level and `into[1..4]` = the clipped level-0
 * rectangle; returns false for a box that must never be rejected (near-plane crossing, empty
 * rectangle, or a rectangle wholly outside the viewport).
 */
export function hizTestRect(minX:number,minY:number,maxX:number,maxY:number,clipsNear:boolean,width:number,height:number,levels:number,into:Int32Array):boolean{
 if(clipsNear||!Number.isInteger(minX)||!Number.isInteger(minY)||!Number.isInteger(maxX)||!Number.isInteger(maxY)||
  maxX<minX||maxY<minY||width<1||height<1||levels<1)return false;
 const x0=minX<0?0:minX,y0=minY<0?0:minY,x1=maxX>width-1?width-1:maxX,y1=maxY>height-1?height-1:maxY;
 if(x1<x0||y1<y0)return false;
 for(let level=0;level<levels;level++){
  const scale=2**level;
  if(Math.floor(x1/scale)-Math.floor(x0/scale)<HIZ_KERNEL_TEXELS&&Math.floor(y1/scale)-Math.floor(y0/scale)<HIZ_KERNEL_TEXELS){
   into[0]=level;into[1]=x0;into[2]=y0;into[3]=x1;into[4]=y1;return true;
  }
 }
 return false;
}

const levelScratch=new Int32Array(HIZ_TEST_VALUES);
function footprintLevel(minX:number,minY:number,maxX:number,maxY:number,clipsNear:boolean,width:number,height:number,levels:number):number|undefined{
 return hizTestRect(minX,minY,maxX,maxY,clipsNear,width,height,levels,levelScratch)?levelScratch[0]:undefined;
}

/**
 * What one image's occlusion test did, counted in clusters and in the triangles those clusters carry.
 * `tested` is what the test was handed, `rejected` what it eliminated, `oversized` those whose level-0
 * screen footprint is wider than the test kernel and which therefore answer from a coarser mip. Every
 * field is a count of one image; nothing is deduced from another field.
 */
export type HizCounts={tested:number;rejected:number;oversized:number;testedTriangles:number;rejectedTriangles:number;oversizedTriangles:number};

export function createHizCounts():HizCounts{
 return {tested:0,rejected:0,oversized:0,testedTriangles:0,rejectedTriangles:0,oversizedTriangles:0};
}
export function resetHizCounts(counts:HizCounts){
 counts.tested=0;counts.rejected=0;counts.oversized=0;
 counts.testedTriangles=0;counts.rejectedTriangles=0;counts.oversizedTriangles=0;
}
/** A screen rectangle the level-0 kernel cannot cover. A near-plane crossing carries no rectangle. */
export function hizOversized(minX:number,minY:number,maxX:number,maxY:number,clipsNear:boolean){
 return !clipsNear&&(maxX-minX>=HIZ_KERNEL_TEXELS||maxY-minY>=HIZ_KERNEL_TEXELS);
}
/** `hizOversized` over the flat bounds layout `projectBoxesFlat` writes. */
export function hizOversizedFlat(bounds:Float64Array,base:number){
 return hizOversized(bounds[base],bounds[base+1],bounds[base+2],bounds[base+3],bounds[base+5]!==0);
}

/** Pick the first mip whose outward-rounded inclusive footprint fits the test kernel. */
export function hizFootprintLevel(bounds:HizBounds,width:number,height:number,levels:number):number|undefined{
 return footprintLevel(bounds.minX,bounds.minY,bounds.maxX,bounds.maxY,bounds.clipsNear,width,height,levels);
}

/** `hizFootprintLevel` over the flat bounds layout `projectBoxesFlat` writes. */
export function hizFootprintLevelFlat(bounds:Float64Array,base:number,width:number,height:number,levels:number):number|undefined{
 return footprintLevel(bounds[base],bounds[base+1],bounds[base+2],bounds[base+3],bounds[base+5]!==0,width,height,levels);
}

/** `hizTestRect` over the flat bounds layout `projectBoxesFlat` writes. */
export function hizTestRectFlat(bounds:Float64Array,base:number,width:number,height:number,levels:number,into:Int32Array):boolean{
 return hizTestRect(bounds[base],bounds[base+1],bounds[base+2],bounds[base+3],bounds[base+5]!==0,width,height,levels,into);
}

const rejectScratch=new Int32Array(HIZ_TEST_VALUES);
export function hizRejects(pyramid:HizPyramid,bounds:HizBounds,bias=0){
 if(!hizTestRect(bounds.minX,bounds.minY,bounds.maxX,bounds.maxY,bounds.clipsNear,pyramid.width,pyramid.height,pyramid.levels.length,rejectScratch))return false;
 const far=hizFootprintFar(pyramid.levels,rejectScratch[1],rejectScratch[2],rejectScratch[3]+1,rejectScratch[4]+1,rejectScratch[0]);
 return hizOccluded(bounds.nearestDepth,far,bias);
}

export function filterUnoccluded<T extends HizPage>(pages:T[],pyramid:HizPyramid,camera:THREE.PerspectiveCamera,viewport:[number,number],bias=0){
 return pages.filter(page=>!hizRejects(pyramid,projectBoxToScreen(page.min,page.max,page.matrix,camera,viewport),bias));
}

/**
 * `filterUnoccluded` that also says what the test did: `counts` gains the clusters it was handed, the
 * clusters it eliminated and the clusters too wide for the level-0 kernel, each with the triangles
 * those clusters carry. This is the oracle the GPU counters are read against on a fixed image.
 */
export function countUnoccluded<T extends HizPage&{array?:ArrayLike<number>}>(pages:T[],pyramid:HizPyramid,camera:THREE.PerspectiveCamera,viewport:[number,number],counts:HizCounts,bias=0){
 const kept:T[]=[];
 for(const page of pages){
  const bounds=projectBoxToScreen(page.min,page.max,page.matrix,camera,viewport);
  const triangles=page.array?Math.floor(page.array.length/3):0;
  counts.tested++;counts.testedTriangles+=triangles;
  if(hizOversized(bounds.minX,bounds.minY,bounds.maxX,bounds.maxY,bounds.clipsNear)){counts.oversized++;counts.oversizedTriangles+=triangles;}
  if(hizRejects(pyramid,bounds,bias)){counts.rejected++;counts.rejectedTriangles+=triangles;continue;}
  kept.push(page);
 }
 return kept;
}

let splitLow=new Uint32Array(0),splitHigh=new Uint32Array(0),splitOrder=new Uint32Array(0),splitScratch=new Uint32Array(0);
const splitCounts=new Uint32Array(256);
const splitKeyDouble=new Float64Array(1),splitKeyWords=new Uint32Array(splitKeyDouble.buffer);
/**
 * `splitOccluders` over the flat bounds `projectBoxesFlat` wrote, without allocating and without any
 * frame history: `rest[i]` becomes 0 for an occluder and 1 otherwise, and the occluder count is
 * returned. The order is the sorting twin's to the bit — a stable radix over the orderable image of
 * the double `nearestDepth`, so equal depths fall back to the candidate order exactly as
 * `a.nearest-b.nearest||a.index-b.index` does.
 */
export function splitOccludersFlat(count:number,bounds:Float64Array,rest:Uint8Array){
 if(splitLow.length<count){splitLow=new Uint32Array(count);splitHigh=new Uint32Array(count);splitOrder=new Uint32Array(count);splitScratch=new Uint32Array(count);}
 let inFront=0;
 for(let i=0;i<count;i++){
  rest[i]=1;
  if(bounds[i*HIZ_BOUNDS_VALUES+5]!==0)continue;
  splitKeyDouble[0]=bounds[i*HIZ_BOUNDS_VALUES+4];
  const low=splitKeyWords[0],high=splitKeyWords[1];
  // Orderable image of a double: flip every bit of a negative, set the sign bit of a positive.
  const negative=(high&0x80000000)!==0;
  splitLow[i]=negative?~low>>>0:low;splitHigh[i]=negative?~high>>>0:(high^0x80000000)>>>0;
  splitOrder[inFront++]=i;
 }
 if(!inFront)return 0;
 let order=splitOrder,scratch=splitScratch;
 for(let pass=0;pass<8;pass++){
  const keys=pass<4?splitLow:splitHigh,shift=(pass&3)*8;
  splitCounts.fill(0);
  for(let i=0;i<inFront;i++)splitCounts[(keys[order[i]]>>>shift)&255]++;
  let total=0;
  for(let digit=0;digit<256;digit++){const n=splitCounts[digit];splitCounts[digit]=total;total+=n;}
  for(let i=0;i<inFront;i++){const index=order[i];scratch[splitCounts[(keys[index]>>>shift)&255]++]=index;}
  const swap=order;order=scratch;scratch=swap;
 }
 splitOrder=order;splitScratch=scratch;
 const occluders=Math.max(1,Math.floor(inFront/2));
 for(let i=0;i<occluders;i++)rest[order[i]]=0;
 return occluders;
}

/** In-front closer half becomes this-frame occluders. Near-plane crossings stay in rest so they cannot hide others. */
export function splitOccluders<T extends HizPage>(pages:T[],camera:THREE.PerspectiveCamera,viewport:[number,number],boundsMap?:Map<T,HizBounds>){
 const ranked=pages.map((page,index)=>{
  const bounds=boundsMap?.get(page)??projectBoxToScreen(page.min,page.max,page.matrix,camera,viewport);
  if(boundsMap)boundsMap.set(page,bounds);
  return {page,index,nearest:bounds.nearestDepth,clipsNear:bounds.clipsNear};
 });
 ranked.sort((a,b)=>a.nearest-b.nearest||a.index-b.index);
 const inFront=ranked.filter(item=>!item.clipsNear),crossing=ranked.filter(item=>item.clipsNear);
 if(!inFront.length)return {occluders:[] as T[],rest:pages};
 const mid=Math.max(1,Math.floor(inFront.length/2));
 return {occluders:inFront.slice(0,mid).map(item=>item.page),rest:[...inFront.slice(mid),...crossing].map(item=>item.page)};
}

/** Previous-frame depth kept for the two-pass occlusion test, and the view it was rendered from. */
export type TemporalHizState = {
 pyramid?: HizPyramid;
 camera?: THREE.PerspectiveCamera;
 viewport?: [number, number];
};

/** Reuse depth only for an identical view. Any camera movement, cut or projection change starts a new history. */
export function sameHizView(previous:THREE.PerspectiveCamera|undefined,current:THREE.PerspectiveCamera){
 if(!previous)return false;
 previous.updateMatrixWorld();current.updateMatrixWorld();
 const equal=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((value,i)=>Math.abs(value-b[i])<=1e-7);
 return equal(previous.matrixWorldInverse.elements,current.matrixWorldInverse.elements)&&equal(previous.projectionMatrix.elements,current.projectionMatrix.elements);
}

/**
 * Apply Temporal Hi-Z occlusion culling using previous frame's depth pyramid reprojection.
 * Candidate pages are tested against the previous frame's Hi-Z pyramid.
 * Previously visible pages form Pass 1 occluders; current frame pyramid is built, then occluded
 * or newly disoccluded pages are tested in Pass 2.
 */
export function applyTemporalHiz<T extends HizPage&VisPage>(
 selected: T[],
 camera: THREE.PerspectiveCamera,
 viewport: [number, number],
 history: TemporalHizState = {}
,
 counts: HizCounts = createHizCounts()
): { shown: T[]; hizRejected: number; occluders: T[]; history: TemporalHizState; counts: HizCounts } {
 resetHizCounts(counts);
 if (selected.length < 2) {
  const vis = rasterVisibility(selected, camera, viewport);
  history.pyramid = buildHizPyramid(vis.depth, viewport[0], viewport[1]);
  history.camera = camera.clone();
  history.viewport = [viewport[0], viewport[1]];
  return { shown: selected, hizRejected: 0, occluders: selected, history, counts };
 }
 const hasPrev = !!(history.pyramid && history.camera && sameHizView(history.camera,camera) && history.viewport &&
  history.viewport[0] === viewport[0] && history.viewport[1] === viewport[1]);

 let occluders: T[], rest: T[];
 if (hasPrev) {
  const prevCam = history.camera!;
  const unoccludedInPrev = filterUnoccluded(selected, history.pyramid!, prevCam, viewport);
  const unoccludedSet = new Set(unoccludedInPrev);
  occluders = selected.filter(p => unoccludedSet.has(p));
  rest = selected.filter(p => !unoccludedSet.has(p));
  if (!occluders.length || !rest.length) {
   const split = splitOccluders(selected, camera, viewport);
   occluders = split.occluders;
   rest = split.rest;
  }
 } else {
  const split = splitOccluders(selected, camera, viewport);
  occluders = split.occluders;
  rest = split.rest;
 }

 if (!occluders.length || !rest.length) {
  const vis = rasterVisibility(selected, camera, viewport);
  history.pyramid = buildHizPyramid(vis.depth, viewport[0], viewport[1]);
  history.camera = camera.clone();
  history.viewport = [viewport[0], viewport[1]];
  return { shown: selected, hizRejected: 0, occluders, history, counts };
 }

 const visPass1 = rasterVisibility(occluders, camera, viewport);
 const currentPyramid = buildHizPyramid(visPass1.depth, viewport[0], viewport[1]);
 const disoccluded = countUnoccluded(rest, currentPyramid, camera, viewport, counts);
 const shown = [...occluders, ...disoccluded];

 const fullVis = rasterVisibility(shown, camera, viewport);
 history.pyramid = buildHizPyramid(fullVis.depth, viewport[0], viewport[1]);
 history.camera = camera.clone();
 history.viewport = [viewport[0], viewport[1]];

 return { shown, hizRejected: rest.length - disoccluded.length, occluders, history, counts };
}
