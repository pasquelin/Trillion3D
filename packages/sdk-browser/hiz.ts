import {HIZ_BACKGROUND,hizBuildPyramid,hizFootprintFar,hizOccluded} from '../sdk-core/index.ts';
import {rasterVisibility,unpackVisibilityId,type VisPage} from './visibilityBuffer.ts';
import * as THREE from 'three';

export type HizPage={min:number[];max:number[];matrix:THREE.Matrix4;url?:string;clusterId?:string};
export type HizBounds={minX:number;minY:number;maxX:number;maxY:number;nearestDepth:number;clipsNear:boolean};
export type HizPyramid={levels:number[][][];width:number;height:number};

const projectScratch=new THREE.Vector3();
const viewScratch=new THREE.Vector3();
const viewProjScratch=new THREE.Matrix4();
const worldCorner=new THREE.Vector3();

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

/** Conservative screen AABB. min/max are inclusive integer samples (fillIds last pixel is ceil(max)). Near-plane crossings never reject. */
export function projectBoxToScreen(min:number[],max:number[],world:THREE.Matrix4,camera:THREE.PerspectiveCamera,viewport:[number,number]):HizBounds{
 const [width,height]=viewport;
 camera.updateMatrixWorld();
 const viewProj=viewProjScratch.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,nearest=Infinity,clipsNear=false,projected=0;
 for(let i=0;i<8;i++){
  worldCorner.set(i&1?max[0]:min[0],i&2?max[1]:min[1],i&4?max[2]:min[2]).applyMatrix4(world);
  viewScratch.copy(worldCorner).applyMatrix4(camera.matrixWorldInverse);
  if(-viewScratch.z<=camera.near)clipsNear=true;
  const e=viewProj.elements,x=worldCorner.x,y=worldCorner.y,z=worldCorner.z;
  const cw=e[3]*x+e[7]*y+e[11]*z+e[15];
  if(cw<=0||!Number.isFinite(cw)){clipsNear=true;continue;}
  const ndcX=(e[0]*x+e[4]*y+e[8]*z+e[12])/cw,ndcY=(e[1]*x+e[5]*y+e[9]*z+e[13])/cw,ndcZ=(e[2]*x+e[6]*y+e[10]*z+e[14])/cw;
  const sx=(ndcX*0.5+0.5)*width,sy=(1-(ndcY*0.5+0.5))*height,sz=ndcZ*0.5+0.5;
  if(sx<minX)minX=sx;if(sy<minY)minY=sy;if(sx>maxX)maxX=sx;if(sy>maxY)maxY=sy;
  if(sz<nearest)nearest=sz;
  projected++;
 }
 if(!projected||clipsNear)return {minX:0,minY:0,maxX:0,maxY:0,nearestDepth:0,clipsNear:true};
 return {minX:Math.floor(minX),minY:Math.floor(minY),maxX:Math.ceil(maxX),maxY:Math.ceil(maxY),nearestDepth:nearest,clipsNear:false};
}

export function hizRejects(pyramid:HizPyramid,bounds:HizBounds,bias=0){
 if(bounds.clipsNear||bounds.maxX<bounds.minX||bounds.maxY<bounds.minY)return false;
 const far=hizFootprintFar(pyramid.levels,bounds.minX,bounds.minY,bounds.maxX+1,bounds.maxY+1,0);
 return hizOccluded(bounds.nearestDepth,far,bias);
}

export function filterUnoccluded<T extends HizPage>(pages:T[],pyramid:HizPyramid,camera:THREE.PerspectiveCamera,viewport:[number,number],bias=0){
 return pages.filter(page=>!hizRejects(pyramid,projectBoxToScreen(page.min,page.max,page.matrix,camera,viewport),bias));
}

/** In-front closer half becomes this-frame occluders. Near-plane crossings stay in rest so they cannot hide others. */
export function splitOccluders<T extends HizPage>(pages:T[],camera:THREE.PerspectiveCamera,viewport:[number,number]){
 const ranked=pages.map((page,index)=>{
  const bounds=projectBoxToScreen(page.min,page.max,page.matrix,camera,viewport);
  return {page,index,nearest:bounds.nearestDepth,clipsNear:bounds.clipsNear};
 });
 ranked.sort((a,b)=>a.nearest-b.nearest||a.index-b.index);
 const inFront=ranked.filter(item=>!item.clipsNear),crossing=ranked.filter(item=>item.clipsNear);
 if(!inFront.length)return {occluders:[] as T[],rest:pages};
 const mid=Math.max(1,Math.floor(inFront.length/2));
 return {occluders:inFront.slice(0,mid).map(item=>item.page),rest:[...inFront.slice(mid),...crossing].map(item=>item.page)};
}

/** Apply this-frame Hi-Z to a selected cut. Remaining ⊆ selected. */
export function applyHiz<T extends HizPage&VisPage>(selected:T[],camera:THREE.PerspectiveCamera,viewport:[number,number]){
 if(selected.length<2)return {shown:selected,hizRejected:0,occluders:selected};
 const {occluders,rest}=splitOccluders(selected,camera,viewport);
 if(!occluders.length||!rest.length)return {shown:selected,hizRejected:0,occluders};
 const vis=rasterVisibility(occluders,camera,viewport);
 const pyramid=buildHizPyramid(vis.depth,viewport[0],viewport[1]);
 const kept=filterUnoccluded(rest,pyramid,camera,viewport);
 return {shown:[...occluders,...kept],hizRejected:rest.length-kept.length,occluders};
}
