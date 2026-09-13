import {lodScore, type Tree} from '../sdk-core/index.ts';
import * as THREE from 'three';
import {OPEN_CONE,coneCullsPage,type NormalCone} from './pageCone.ts';

const NONE=0xFFFFFFFF,CULLED=1,COARSE=2,CONE_CULLED=4,NODE_FLOATS=8,NODE_META=8,PAGE_CONE_FLOATS=12,UNIFORM_BYTES=256,WORKGROUP=64;
const FLAG_HAS_ERROR=1;

export type SelectionUniforms={planes:Float32Array;view:Float32Array;pixelScale:[number,number];pixelError:number;near:number;cameraWorld:[number,number,number]};
export type PackedForest={
 nodes:Float32Array;meta:Uint32Array;extras:Uint32Array;worlds:Float32Array;cones:Float32Array;pageCones:Float32Array;
 nodeCount:number;rootCount:number;worldCount:number;childOffset:number;rootOffset:number;pageCount:number;pageUrls:string[];
};
export type SelectionResult={pageIds:number[];frustumRejected:number;lodLevel:number};
export type GpuCut={uniforms:SelectionUniforms;result:SelectionResult};
export type GpuSelection={
 dispatch(uniforms:SelectionUniforms):void;
 peek():GpuCut|null;
 failed():boolean;
 flush():Promise<SelectionResult|null>;
 dispose():void;
};

const scratch={box:new THREE.Box3(),min:new THREE.Vector3(),max:new THREE.Vector3(),corner:new THREE.Vector3(),world:new THREE.Matrix4(),view:new THREE.Matrix4(),viewMatrix:new THREE.Matrix4(),vp:new THREE.Matrix4(),frustum:new THREE.Frustum(),viewMin:[Infinity,Infinity,Infinity] as [number,number,number],viewMax:[-Infinity,-Infinity,-Infinity] as [number,number,number],cam:new THREE.PerspectiveCamera(),camPos:new THREE.Vector3(),cone:{axis:[0,0,1] as [number,number,number],angle:Math.PI},minArr:[0,0,0] as number[],maxArr:[0,0,0] as number[],pageMin:[0,0,0] as number[],pageMax:[0,0,0] as number[]};
const planeScratch=new Float32Array(24),viewScratch=new Float32Array(16);

export const SELECTION_SHADER=`struct Node{min:vec3f,errorObject:f32,max:vec3f,pad0:f32,page:u32,coarseStart:u32,coarseCount:u32,childStart:u32,childCount:u32,depth:u32,flags:u32,worldIndex:u32,}
struct Uniforms{planes:array<vec4f,6>,view:mat4x4f,pixelScale:vec2f,pixelError:f32,near:f32,nodeCount:u32,rootCount:u32,childOffset:u32,rootOffset:u32,cameraWorld:vec3f,}
struct Output{count:u32,frustumRejected:u32,lodLevel:u32,overflow:u32,pages:array<u32>,}
@group(0) @binding(0) var<storage, read> nodes:array<Node>;
@group(0) @binding(1) var<storage, read> extras:array<u32>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
@group(0) @binding(3) var<storage, read_write> flags:array<u32>;
@group(0) @binding(4) var<storage, read_write> out:Output;
@group(0) @binding(5) var<storage, read_write> stack:array<u32>;
@group(0) @binding(6) var<storage, read> worlds:array<mat4x4f>;
@group(0) @binding(7) var<storage, read> cones:array<vec4f>;
struct PageCone{cone:vec4f,min:vec3f,hasBox:f32,max:vec3f,pad:f32,}
@group(0) @binding(8) var<storage, read> pageCones:array<PageCone>;
struct Bounds{min:vec3f,max:vec3f,}
fn applyPoint(m:mat4x4f,p:vec3f)->vec3f{let v=m*vec4f(p,1.0);return v.xyz;}
fn worldAabb(node:Node)->Bounds{
 let world=worlds[node.worldIndex];
 let c=(node.min+node.max)*0.5;let e=(node.max-node.min)*0.5;
 let wc=(world*vec4f(c,1.0)).xyz;
 let we=abs(world[0].xyz)*e.x+abs(world[1].xyz)*e.y+abs(world[2].xyz)*e.z;
 return Bounds(wc-we,wc+we);
}
fn culled(node:Node)->bool{
 let box=worldAabb(node);let wmin=box.min;let wmax=box.max;
 for(var i=0u;i<6u;i++){
  let plane=uni.planes[i];
  let px=select(wmin.x,wmax.x,plane.x>0.0);let py=select(wmin.y,wmax.y,plane.y>0.0);let pz=select(wmin.z,wmax.z,plane.z>0.0);
  if(dot(plane.xyz,vec3f(px,py,pz))+plane.w<0.0){return true;}
 }
 return false;
}
fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{
 let a=m[0];let b=m[1];let c=m[2];
 let det=dot(a,cross(b,c));
 if(abs(det)<1e-20){return v;}
 return (1.0/det)*(mat3x3f(cross(b,c),cross(c,a),cross(a,b))*v);
}
fn isConformal(m:mat3x3f)->bool{
 let lx2=dot(m[0],m[0]);let ly2=dot(m[1],m[1]);let lz2=dot(m[2],m[2]);
 let maxl=max(lx2,max(ly2,lz2));let minl=min(lx2,min(ly2,lz2));
 if(maxl>minl*1.0001+1e-12){return false;}
 let eps=maxl*1e-4+1e-12;
 return abs(dot(m[0],m[1]))<=eps&&abs(dot(m[0],m[2]))<=eps&&abs(dot(m[1],m[2]))<=eps;
}
fn coneRejectsBox(cone:vec4f,bmin:vec3f,bmax:vec3f,world:mat4x4f)->bool{
 if(cone.w>=1.57079632679){return false;}
 let m=mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz);
 if(!isConformal(m)){return false;}
 let c=0.5*(bmin+bmax);let e=0.5*(bmax-bmin);
 let wc=(world*vec4f(c,1.0)).xyz;
 let we=abs(world[0].xyz)*e.x+abs(world[1].xyz)*e.y+abs(world[2].xyz)*e.z;
 let wmin=wc-we;let wmax=wc+we;
 let center=0.5*(wmin+wmax);
 let cam=uni.cameraWorld;
 let toCam=cam-center;
 let dist=length(toCam);
 if(dist==0.0){return false;}
 let view=toCam/dist;
 let axis=inverseTranspose3(m,cone.xyz);
 let al=length(axis);
 if(!(al>0.0)){return false;}
 let axisWorld=axis/al;
 let radius=length(0.5*(wmax-wmin));
 if(dist<=radius){return false;}
 let spread=asin(clamp(radius/dist,0.0,1.0));
 let d=dot(axisWorld,view);
 return d<-sin(cone.w+spread)&&(cone.w+spread)<1.57079632679;
}
fn coneCulled(node:Node,index:u32)->bool{
 if(node.page==0xffffffffu){return false;}
 return coneRejectsBox(cones[index],node.min,node.max,worlds[node.worldIndex]);
}
fn pageConeCulled(page:u32,node:Node)->bool{
 let rec=pageCones[page];
 var bmin=node.min;var bmax=node.max;
 if(rec.hasBox!=0.0){bmin=rec.min;bmax=rec.max;}
 return coneRejectsBox(rec.cone,bmin,bmax,worlds[node.worldIndex]);
}
fn lodOk(node:Node)->bool{
 if(node.coarseCount==0u||(node.flags&1u)==0u||uni.pixelError<=0.0){return false;}
 let vm=uni.view*worlds[node.worldIndex];
 let c=(node.min+node.max)*0.5;let e=(node.max-node.min)*0.5;
 let vc=(vm*vec4f(c,1.0)).xyz;
 let ve=abs(vm[0].xyz)*e.x+abs(vm[1].xyz)*e.y+abs(vm[2].xyz)*e.z;
 let viewMin=vec3f(vc.xy-ve.xy,-vc.z-ve.z);let viewMax=vec3f(vc.xy+ve.xy,-vc.z+ve.z);
 let scale2=dot(vm[0].xyz,vm[0].xyz)+dot(vm[1].xyz,vm[1].xyz)+dot(vm[2].xyz,vm[2].xyz);
 let errorScale=sqrt(scale2);let errorView=node.errorObject*errorScale;
 if(!(errorView>=0.0)||uni.near<=0.0||uni.pixelScale.x<=0.0||uni.pixelScale.y<=0.0){return false;}
 if(viewMin.z<=uni.near){return false;}
 let tx=max(abs(viewMin.x),abs(viewMax.x));let ty=max(abs(viewMin.y),abs(viewMax.y));
 let maxFocal=max(abs(uni.pixelScale.x),abs(uni.pixelScale.y));
 let score=((errorView*maxFocal)/viewMin.z)*sqrt(1.0+(tx*tx+ty*ty)/(viewMin.z*viewMin.z));
 return score<=uni.pixelError;
}
fn emitOne(page:u32){
 let cap=arrayLength(&out.pages);
 if(out.overflow!=0u){return;}
 let slot=out.count;
 if(slot>=cap){out.overflow=1u;return;}
 out.pages[slot]=page;out.count=slot+1u;
}
fn emitPages(node:Node){for(var k=0u;k<node.coarseCount;k++){let page=extras[node.coarseStart+k];if(pageConeCulled(page,node)){continue;}emitOne(page);}}
fn push(value:u32,sp:ptr<function,u32>)->bool{
 let cap=arrayLength(&stack);
 if(*sp>=cap){out.overflow=1u;return false;}
 stack[*sp]=value;*sp=*sp+1u;return true;
}
@compute @workgroup_size(64)
fn flagNodes(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.nodeCount){return;}
 let node=nodes[i];
 if(culled(node)){flags[i]=1u;return;}
 if(coneCulled(node,i)){flags[i]=4u;return;}
 flags[i]=select(0u,2u,lodOk(node));
}
@compute @workgroup_size(1)
fn resolveSelection(){
 out.count=0u;out.frustumRejected=0u;out.lodLevel=0u;out.overflow=0u;
 var sp=0u;
 for(var r=0u;r<uni.rootCount;r++){if(!push(extras[uni.rootOffset+r],&sp)){return;}}
 while(sp>0u){
  sp=sp-1u;
  let index=stack[sp];
  let node=nodes[index];
  if((flags[index]&1u)!=0u){out.frustumRejected=out.frustumRejected+1u;continue;}
  if((flags[index]&4u)!=0u){continue;}
  if((flags[index]&2u)!=0u){out.lodLevel=max(out.lodLevel,node.depth);emitPages(node);continue;}
  if(node.page!=0xffffffffu){emitOne(node.page);continue;}
  var c=node.childCount;
  while(c>0u){c=c-1u;if(!push(extras[node.childStart+c],&sp)){return;}}
 }
}
`;

export function sameSelectionUniforms(a:SelectionUniforms,b:SelectionUniforms){
 if(a.pixelError!==b.pixelError||a.near!==b.near||a.pixelScale[0]!==b.pixelScale[0]||a.pixelScale[1]!==b.pixelScale[1])return false;
 if(a.cameraWorld[0]!==b.cameraWorld[0]||a.cameraWorld[1]!==b.cameraWorld[1]||a.cameraWorld[2]!==b.cameraWorld[2])return false;
 for(let i=0;i<16;i++)if(a.view[i]!==b.view[i])return false;
 for(let i=0;i<24;i++)if(a.planes[i]!==b.planes[i])return false;
 return true;
}

export function copySelectionUniforms(source:SelectionUniforms):SelectionUniforms{
 return {planes:source.planes.slice(),view:source.view.slice(),pixelScale:[source.pixelScale[0],source.pixelScale[1]],pixelError:source.pixelError,near:source.near,cameraWorld:[source.cameraWorld[0],source.cameraWorld[1],source.cameraWorld[2]]};
}

function leafCone(page:{cone?:NormalCone;material?:THREE.Material|THREE.Material[]}):NormalCone{
 const material=page.material;
 if(material){
  const side=Array.isArray(material)?material[0]?.side:material.side;
  if(side===THREE.DoubleSide||side===THREE.BackSide)return OPEN_CONE;
 }
 return page.cone??OPEN_CONE;
}

export function packSelectionForest<T extends {url:string;cone?:NormalCone;material?:THREE.Material|THREE.Material[];min?:number[];max?:number[]}>(roots:Array<{tree:Tree;world:THREE.Matrix4;pages:T[]}>):PackedForest{
 const pageUrls:string[]=[],packed:{min:number[];max:number[];errorObject:number;hasError:boolean;worldIndex:number;page:number;coarseStart:number;coarseCount:number;childStart:number;childCount:number;depth:number;cone:NormalCone}[]=[],coarse:number[]=[],children:number[]=[],rootIds:number[]=[],worlds:number[][]=[],pageConeList:number[]=[];
 for(const root of roots){
  const base=pageUrls.length,worldIndex=worlds.length;
  for(const rec of root.pages){
   pageUrls.push(rec.url);
   const cone=leafCone(rec),hasBox=rec.min&&rec.max?1:0;
   pageConeList.push(cone.axis[0],cone.axis[1],cone.axis[2],cone.angle);
   pageConeList.push(hasBox?rec.min![0]:0,hasBox?rec.min![1]:0,hasBox?rec.min![2]:0,hasBox);
   pageConeList.push(hasBox?rec.max![0]:0,hasBox?rec.max![1]:0,hasBox?rec.max![2]:0,0);
  }
  worlds.push([...root.world.elements]);
  const walk=(node:Tree,depth:number):number=>{
   const childIds:number[]=[];if(node.children)for(const child of node.children)childIds.push(walk(child,depth+1));
   const childStart=children.length;for(const id of childIds)children.push(id);
   const coarseStart=coarse.length;let coarseCount=0;
   if(node.coarsePages)for(const id of node.coarsePages)if(root.pages[id]){coarse.push(base+id);coarseCount++;}
   const rec=node.page!==undefined?root.pages[node.page]:undefined;
   const page=rec?base+node.page!:NONE;
   const cone=rec?leafCone(rec):OPEN_CONE;
   const index=packed.length;
   packed.push({min:node.min,max:node.max,errorObject:node.errorObject??0,hasError:node.errorObject!=null,worldIndex,page,coarseStart,coarseCount,childStart,childCount:childIds.length,depth,cone});
   return index;
  };
  rootIds.push(walk(root.tree,1));
 }
 const childOffset=coarse.length,rootOffset=coarse.length+children.length;
 const extras=new Uint32Array(coarse.length+children.length+rootIds.length);
 extras.set(coarse,0);extras.set(children,childOffset);extras.set(rootIds,rootOffset);
 const nodeCount=packed.length,nodes=new Float32Array(Math.max(0,nodeCount)*NODE_FLOATS),meta=new Uint32Array(Math.max(0,nodeCount)*NODE_META);
 const cones=new Float32Array(Math.max(0,nodeCount)*4);
 const pageCones=new Float32Array(pageConeList);
 const worldCount=worlds.length,worldBuffer=new Float32Array(worldCount*16);
 for(let i=0;i<worldCount;i++)worldBuffer.set(worlds[i],i*16);
 for(let i=0;i<nodeCount;i++){
  const node=packed[i],base=i*NODE_FLOATS,ints=i*NODE_META,coneBase=i*4;
  nodes[base]=node.min[0];nodes[base+1]=node.min[1];nodes[base+2]=node.min[2];nodes[base+3]=node.errorObject;
  nodes[base+4]=node.max[0];nodes[base+5]=node.max[1];nodes[base+6]=node.max[2];
  meta[ints]=node.page;meta[ints+1]=node.coarseStart;meta[ints+2]=node.coarseCount;
  meta[ints+3]=childOffset+node.childStart;meta[ints+4]=node.childCount;meta[ints+5]=node.depth;
  meta[ints+6]=node.hasError?FLAG_HAS_ERROR:0;meta[ints+7]=node.worldIndex;
  cones[coneBase]=node.cone.axis[0];cones[coneBase+1]=node.cone.axis[1];cones[coneBase+2]=node.cone.axis[2];cones[coneBase+3]=node.cone.angle;
 }
 return {nodes,meta,extras,worlds:worldBuffer,cones,pageCones,nodeCount,rootCount:rootIds.length,worldCount,childOffset,rootOffset,pageCount:pageUrls.length,pageUrls};
}

export function cameraSelectionUniforms(camera:THREE.PerspectiveCamera,pixelError:number,viewport?:[number,number],into?:SelectionUniforms):SelectionUniforms{
 camera.updateMatrixWorld();
 const {vp,frustum,camPos}=scratch;
 frustum.setFromProjectionMatrix(vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const planes=into?.planes??planeScratch;
 const view=into?.view??viewScratch;
 for(let i=0;i<6;i++){const plane=frustum.planes[i];planes[i*4]=plane.normal.x;planes[i*4+1]=plane.normal.y;planes[i*4+2]=plane.normal.z;planes[i*4+3]=plane.constant;}
 view.set(camera.matrixWorldInverse.elements);
 const width=viewport?.[0]??1,height=viewport?.[1]??1;
 const pixelScale:[number,number]=into?.pixelScale??[1,1];
 pixelScale[0]=width*Math.abs(camera.projectionMatrix.elements[0])/2;
 pixelScale[1]=height*Math.abs(camera.projectionMatrix.elements[5])/2;
 camera.getWorldPosition(camPos);
 const cameraWorld:[number,number,number]=into?.cameraWorld??[camPos.x,camPos.y,camPos.z];
 cameraWorld[0]=camPos.x;cameraWorld[1]=camPos.y;cameraWorld[2]=camPos.z;
 if(into){into.pixelError=pixelError;into.near=camera.near;into.cameraWorld=cameraWorld;return into;}
 return {planes:planes.slice(),view:view.slice(),pixelScale:[pixelScale[0],pixelScale[1]],pixelError,near:camera.near,cameraWorld:[cameraWorld[0],cameraWorld[1],cameraWorld[2]]};
}

function nodeWorld(packed:PackedForest,index:number){
 const base=index*NODE_FLOATS,worldIndex=packed.meta[index*NODE_META+7];
 scratch.min.set(packed.nodes[base],packed.nodes[base+1],packed.nodes[base+2]);
 scratch.max.set(packed.nodes[base+4],packed.nodes[base+5],packed.nodes[base+6]);
 scratch.world.fromArray(packed.worlds.subarray(worldIndex*16,worldIndex*16+16));
}

function nodeFlags(packed:PackedForest,uniforms:SelectionUniforms,index:number){
 nodeWorld(packed,index);
 const min=scratch.min,max=scratch.max;
 const cx=(min.x+max.x)*0.5,cy=(min.y+max.y)*0.5,cz=(min.z+max.z)*0.5;
 const ex=(max.x-min.x)*0.5,ey=(max.y-min.y)*0.5,ez=(max.z-min.z)*0.5;
 const we=scratch.world.elements;
 const wcx=we[0]*cx+we[4]*cy+we[8]*cz+we[12];
 const wcy=we[1]*cx+we[5]*cy+we[9]*cz+we[13];
 const wcz=we[2]*cx+we[6]*cy+we[10]*cz+we[14];
 const wex=Math.abs(we[0])*ex+Math.abs(we[4])*ey+Math.abs(we[8])*ez;
 const wey=Math.abs(we[1])*ex+Math.abs(we[5])*ey+Math.abs(we[9])*ez;
 const wez=Math.abs(we[2])*ex+Math.abs(we[6])*ey+Math.abs(we[10])*ez;
 const wminX=wcx-wex,wmaxX=wcx+wex;
 const wminY=wcy-wey,wmaxY=wcy+wey;
 const wminZ=wcz-wez,wmaxZ=wcz+wez;
 const planes=uniforms.planes;
 for(let i=0;i<6;i++){
  const nx=planes[i*4],ny=planes[i*4+1],nz=planes[i*4+2],c=planes[i*4+3];
  const px=nx>0?wmaxX:wminX,py=ny>0?wmaxY:wminY,pz=nz>0?wmaxZ:wminZ;
  if(nx*px+ny*py+nz*pz+c<0)return CULLED;
 }
 const ints=index*NODE_META;
 if(packed.meta[ints]!==NONE){
  const coneBase=index*4,{cone,minArr,maxArr,cam}=scratch;
  cone.axis[0]=packed.cones[coneBase];cone.axis[1]=packed.cones[coneBase+1];cone.axis[2]=packed.cones[coneBase+2];cone.angle=packed.cones[coneBase+3];
  minArr[0]=min.x;minArr[1]=min.y;minArr[2]=min.z;maxArr[0]=max.x;maxArr[1]=max.y;maxArr[2]=max.z;
  const cw=uniforms.cameraWorld;
  if(cw){cam.position.set(cw[0],cw[1],cw[2]);cam.updateMatrixWorld();if(coneCullsPage(cone,scratch.world,minArr,maxArr,cam))return CONE_CULLED;}
 }
 const coarseCount=packed.meta[ints+2],hasError=packed.meta[ints+6]&FLAG_HAS_ERROR;
 if(!coarseCount||!hasError||!(uniforms.pixelError>0))return 0;
 scratch.view.fromArray(uniforms.view);scratch.viewMatrix.multiplyMatrices(scratch.view,scratch.world);
 const ve=scratch.viewMatrix.elements;
 const vcx=ve[0]*cx+ve[4]*cy+ve[8]*cz+ve[12];
 const vcy=ve[1]*cx+ve[5]*cy+ve[9]*cz+ve[13];
 const vcz=ve[2]*cx+ve[6]*cy+ve[10]*cz+ve[14];
 const vex=Math.abs(ve[0])*ex+Math.abs(ve[4])*ey+Math.abs(ve[8])*ez;
 const vey=Math.abs(ve[1])*ex+Math.abs(ve[5])*ey+Math.abs(ve[9])*ez;
 const vez=Math.abs(ve[2])*ex+Math.abs(ve[6])*ey+Math.abs(ve[10])*ez;
 const {viewMin,viewMax}=scratch;
 viewMin[0]=vcx-vex;viewMax[0]=vcx+vex;
 viewMin[1]=vcy-vey;viewMax[1]=vcy+vey;
 viewMin[2]=-vcz-vez;viewMax[2]=-vcz+vez;
 const errorScale=Math.hypot(ve[0],ve[1],ve[2],ve[4],ve[5],ve[6],ve[8],ve[9],ve[10]);
 try{if(lodScore(packed.nodes[index*NODE_FLOATS+3],errorScale,viewMin,viewMax,uniforms.pixelScale,'perspective',uniforms.near)<=uniforms.pixelError)return COARSE;}catch{/* Keep the fine representation when the screen-error bound is undefined. */}
 return 0;
}

function pageEmitCulled(packed:PackedForest,uniforms:SelectionUniforms,page:number,world:THREE.Matrix4,fallbackMin:number[],fallbackMax:number[]){
 const pc=packed.pageCones,base=page*PAGE_CONE_FLOATS;
 if(!pc||base+11>=pc.length)return false;
 const {cone,cam,pageMin,pageMax}=scratch;
 cone.axis[0]=pc[base];cone.axis[1]=pc[base+1];cone.axis[2]=pc[base+2];cone.angle=pc[base+3];
 const hasBox=pc[base+7];
 if(hasBox){pageMin[0]=pc[base+4];pageMin[1]=pc[base+5];pageMin[2]=pc[base+6];pageMax[0]=pc[base+8];pageMax[1]=pc[base+9];pageMax[2]=pc[base+10];}
 const min=hasBox?pageMin:fallbackMin,max=hasBox?pageMax:fallbackMax;
 const cw=uniforms.cameraWorld;if(!cw)return false;
 cam.position.set(cw[0],cw[1],cw[2]);cam.updateMatrixWorld();
 return coneCullsPage(cone,world,min,max,cam);
}

export function evaluateSelectionKernel(packed:PackedForest,uniforms:SelectionUniforms):SelectionResult{
 const pageIds:number[]=[],flags=new Uint32Array(packed.nodeCount);
 let frustumRejected=0,lodLevel=0;
 for(let i=0;i<packed.nodeCount;i++)flags[i]=nodeFlags(packed,uniforms,i);
 const visit=(index:number)=>{
  if(flags[index]&CULLED){frustumRejected++;return;}
  if(flags[index]&CONE_CULLED)return;
  const ints=index*NODE_META;
  if(flags[index]&COARSE){
   lodLevel=Math.max(lodLevel,packed.meta[ints+5]);
   nodeWorld(packed,index);
   const {minArr,maxArr}=scratch;
   minArr[0]=scratch.min.x;minArr[1]=scratch.min.y;minArr[2]=scratch.min.z;
   maxArr[0]=scratch.max.x;maxArr[1]=scratch.max.y;maxArr[2]=scratch.max.z;
   const start=packed.meta[ints+1],count=packed.meta[ints+2];
   for(let k=0;k<count;k++){
    const page=packed.extras[start+k];
    if(pageEmitCulled(packed,uniforms,page,scratch.world,minArr,maxArr))continue;
    pageIds.push(page);
   }
   return;
  }
  const page=packed.meta[ints];
  if(page!==NONE){pageIds.push(page);return;}
  const start=packed.meta[ints+3],count=packed.meta[ints+4];
  for(let c=0;c<count;c++)visit(packed.extras[start+c]);
 };
 for(let r=0;r<packed.rootCount;r++)visit(packed.extras[packed.rootOffset+r]);
 return {pageIds,frustumRejected,lodLevel};
}

function writeUniforms(target:Float32Array,packed:PackedForest,uniforms:SelectionUniforms){
 target.fill(0);target.set(uniforms.planes,0);target.set(uniforms.view,24);target[40]=uniforms.pixelScale[0];target[41]=uniforms.pixelScale[1];target[42]=uniforms.pixelError;target[43]=uniforms.near;
 const ints=new Uint32Array(target.buffer,target.byteOffset,target.length);
 ints[44]=packed.nodeCount;ints[45]=packed.rootCount;ints[46]=packed.childOffset;ints[47]=packed.rootOffset;
 const cw=uniforms.cameraWorld;if(cw){target[48]=cw[0];target[49]=cw[1];target[50]=cw[2];}
}

function interleaveNodes(packed:PackedForest){
 const bytes=new Uint8Array(packed.nodeCount*64);
 const f32=new Float32Array(bytes.buffer),u32=new Uint32Array(bytes.buffer);
 for(let i=0;i<packed.nodeCount;i++){
  const dst=i*16,src=i*NODE_FLOATS,meta=i*NODE_META;
  f32.set(packed.nodes.subarray(src,src+8),dst);
  u32.set(packed.meta.subarray(meta,meta+NODE_META),dst+8);
 }
 return bytes;
}

function parseOutput(bytes:ArrayBufferLike,byteOffset=0,byteLength=bytes.byteLength):SelectionResult|null{
 const ints=new Uint32Array(bytes,byteOffset,Math.floor(byteLength/4));
 if((ints[3]??0)!==0)return null;
 const count=Math.min(ints[0]??0,Math.max(0,ints.length-4));
 return {pageIds:[...ints.subarray(4,4+count)],frustumRejected:ints[1]??0,lodLevel:ints[2]??0};
}

/** WebGPU frustum + lodScore cut. Returns undefined so the caller keeps the CPU oracle silently. */
export async function createGpuSelection(device:GPUDevice,packed:PackedForest):Promise<GpuSelection|undefined>{
 if(typeof device.createComputePipeline!=='function'||packed.nodeCount<1)return undefined;
 const pageCount=Math.max(1,packed.pageCount),nodeCount=packed.nodeCount;
 const extrasBytes=Math.max(4,packed.extras.byteLength),flagsBytes=Math.max(4,nodeCount*4),outputBytes=16+pageCount*4;
 const worldBytes=Math.max(64,packed.worlds.byteLength),stackBytes=Math.max(4,nodeCount*4),coneBytes=Math.max(16,packed.cones.byteLength);
 const pageConeBytes=Math.max(48,packed.pageCones.byteLength);
 const uniformData=new Float32Array(UNIFORM_BYTES/4);
 let last:GpuCut|null=null,lastSubmitted:SelectionUniforms|undefined,pending:Promise<unknown>=Promise.resolve(),disposed=false,dead=false;
 const mapped=[false,false];let slot=0;
 const buffers:GPUBuffer[]=[];
 const nodeBytes=interleaveNodes(packed);
 const fail=()=>{dead=true;last=null;lastSubmitted=undefined;};
 try{
  const nodes=device.createBuffer({size:nodeBytes.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const extras=device.createBuffer({size:extrasBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const uniforms=device.createBuffer({size:UNIFORM_BYTES,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const flags=device.createBuffer({size:flagsBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  const output=device.createBuffer({size:outputBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  const stack=device.createBuffer({size:stackBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const worlds=device.createBuffer({size:worldBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const cones=device.createBuffer({size:coneBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const pageCones=device.createBuffer({size:pageConeBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const readback=[
   device.createBuffer({size:outputBytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),
   device.createBuffer({size:outputBytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),
  ];
  buffers.push(nodes,extras,uniforms,flags,output,stack,worlds,cones,pageCones,...readback);
  if(typeof device.pushErrorScope==='function')device.pushErrorScope('validation');
  const layout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
   {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  ]});
  const module=device.createShaderModule({code:SELECTION_SHADER});
  if(typeof module.getCompilationInfo==='function'){
   const info=await module.getCompilationInfo();
   if(info.messages.some(message=>message.type==='error')){
    if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
    for(const buffer of buffers)buffer.destroy();
    return undefined;
   }
  }
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const flagPipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'flagNodes'}});
  const resolvePipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'resolveSelection'}});
  if(typeof device.popErrorScope==='function'){
   const error=await device.popErrorScope();
   if(error){for(const buffer of buffers)buffer.destroy();return undefined;}
  }
  const bindGroup=device.createBindGroup({layout,entries:[
   {binding:0,resource:{buffer:nodes}},{binding:1,resource:{buffer:extras}},{binding:2,resource:{buffer:uniforms}},
   {binding:3,resource:{buffer:flags}},{binding:4,resource:{buffer:output}},{binding:5,resource:{buffer:stack}},
   {binding:6,resource:{buffer:worlds}},{binding:7,resource:{buffer:cones}},{binding:8,resource:{buffer:pageCones}},
  ]});
  device.queue.writeBuffer(nodes,0,nodeBytes);
  const extrasCopy=new Uint8Array(extrasBytes);if(packed.extras.byteLength)extrasCopy.set(new Uint8Array(packed.extras.buffer,packed.extras.byteOffset,packed.extras.byteLength));
  device.queue.writeBuffer(extras,0,extrasCopy);
  const worldCopy=new Uint8Array(worldBytes);if(packed.worlds.byteLength)worldCopy.set(new Uint8Array(packed.worlds.buffer,packed.worlds.byteOffset,packed.worlds.byteLength));
  device.queue.writeBuffer(worlds,0,worldCopy);
  const coneCopy=new Uint8Array(coneBytes);if(packed.cones.byteLength)coneCopy.set(new Uint8Array(packed.cones.buffer,packed.cones.byteOffset,packed.cones.byteLength));
  device.queue.writeBuffer(cones,0,coneCopy);
  const pageConeCopy=new Uint8Array(pageConeBytes);if(packed.pageCones.byteLength)pageConeCopy.set(new Uint8Array(packed.pageCones.buffer,packed.pageCones.byteOffset,packed.pageCones.byteLength));
  device.queue.writeBuffer(pageCones,0,pageConeCopy);
  return {
   dispatch(next){
    if(disposed||dead)return;
    if(lastSubmitted&&sameSelectionUniforms(lastSubmitted,next))return;
    const i=slot;if(mapped[i])return;
    writeUniforms(uniformData,packed,next);device.queue.writeBuffer(uniforms,0,uniformData);
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginComputePass();
    pass.setPipeline(flagPipeline);pass.setBindGroup(0,bindGroup);pass.dispatchWorkgroups(Math.max(1,Math.ceil(packed.nodeCount/WORKGROUP)));
    pass.setPipeline(resolvePipeline);pass.setBindGroup(0,bindGroup);pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(output,0,readback[i],0,outputBytes);
    device.queue.submit([encoder.finish()]);
    const captured=copySelectionUniforms(next);
    lastSubmitted=captured;mapped[i]=true;slot^=1;
    pending=pending.catch(()=>{}).then(async()=>{
     try{
      await readback[i].mapAsync(GPUMapMode.READ);
      const parsed=parseOutput(readback[i].getMappedRange());
      readback[i].unmap();mapped[i]=false;
      if(!parsed){fail();return;}
      last={uniforms:captured,result:parsed};
     }catch{try{readback[i].unmap();}catch{/* Mapping may already be closed. */}mapped[i]=false;fail();}
    });
   },
   peek(){return dead?null:last;},
   failed(){return dead;},
   async flush(){await pending;return dead?null:last?.result??null;},
   dispose(){disposed=true;dead=true;pending=pending.catch(()=>{});for(const buffer of buffers)buffer.destroy();},
  };
 }catch{
  if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
  for(const buffer of buffers)try{buffer.destroy();}catch{/* Partial GPU selection setup must not leak. */}
  return undefined;
 }
}
