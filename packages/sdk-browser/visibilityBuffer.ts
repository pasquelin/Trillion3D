import * as THREE from 'three';
import {HIZ_BACKGROUND} from '../sdk-core/index.ts';
import {RASTER_BACKGROUND} from './pageRaster.ts';

export const VIS_INVALID=0;
export const PAGE_INFO_STRIDE=128;
export const FLAG_LIT=1,FLAG_DOUBLE=2,FLAG_HAS_UV=4,FLAG_HAS_MAP=8,FLAG_HAS_NORMAL=16,FLAG_WRAP_S_REPEAT=32,FLAG_WRAP_T_REPEAT=64;
const normalScratch=new THREE.Matrix3();
const projectScratch=new THREE.Vector3();

export type VisPage={
 array:Uint32Array;
 attributes:THREE.BufferGeometry['attributes'];
 matrix:THREE.Matrix4;
 material:THREE.Material|THREE.Material[];
 clusterId?:string;
};

export type VisMaterial={
 baseColor:[number,number,number];
 metalness:number;
 roughness:number;
 lit:boolean;
 doubleSided:boolean;
 map?:THREE.Texture;
};

export type UnpackedVisibility={pageIndex:number;triangleIndex:number};

export function packVisibilityId(pageIndex:number,triangleIndex:number){
 if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>0xfffe||!Number.isInteger(triangleIndex)||triangleIndex<0||triangleIndex>0xffff)throw new Error('VISIBILITY_ID_RANGE');
 return ((pageIndex+1)<<16)|(triangleIndex&0xffff);
}

export function unpackVisibilityId(id:number):UnpackedVisibility|null{
 if(id===VIS_INVALID)return null;
 return {pageIndex:(id>>>16)-1,triangleIndex:id&0xffff};
}

export function visMaterial(material:THREE.Material|THREE.Material[]):VisMaterial{
 const first=Array.isArray(material)?material[0]:material;
 const color='color' in first&&first.color instanceof THREE.Color?first.color:new THREE.Color(1,1,1);
 const std=first as THREE.MeshStandardMaterial;
 const lit=!!std.isMeshStandardMaterial;
 return {
  baseColor:[color.r,color.g,color.b],
  metalness:lit?std.metalness:0,
  roughness:lit?std.roughness:1,
  lit,
  doubleSided:first.side===THREE.DoubleSide,
  map:'map' in first&&first.map?first.map as THREE.Texture:undefined,
 };
}

export function textureRgba(texture:THREE.Texture):{data:Uint8Array;width:number;height:number}|null{
 const image=texture.image as {data?:ArrayBufferView;width?:number;height?:number}|undefined;
 if(!image?.data||!image.width||!image.height)return null;
 const src=image.data;
 return {data:new Uint8Array(src.buffer,src.byteOffset,src.byteLength),width:image.width,height:image.height};
}

function backgroundRgb(){return [(RASTER_BACKGROUND>>16)&255,(RASTER_BACKGROUND>>8)&255,RASTER_BACKGROUND&255];}

function project(matrix:THREE.Matrix4,position:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,vi:number,viewProj:THREE.Matrix4,width:number,height:number){
 const v=projectScratch.set(position.getX(vi),position.getY(vi),position.getZ(vi)).applyMatrix4(matrix);
 const e=viewProj.elements;
 const cx=e[0]*v.x+e[4]*v.y+e[8]*v.z+e[12],cy=e[1]*v.x+e[5]*v.y+e[9]*v.z+e[13],cz=e[2]*v.x+e[6]*v.y+e[10]*v.z+e[14],cw=e[3]*v.x+e[7]*v.y+e[11]*v.z+e[15];
 if(cw===0||!Number.isFinite(cw))return null;
 const ndcX=cx/cw,ndcY=cy/cw,ndcZ=cz/cw;
 return {x:(ndcX*0.5+0.5)*width,y:(1-(ndcY*0.5+0.5))*height,z:ndcZ*0.5+0.5,invW:1/cw,worldX:v.x,worldY:v.y,worldZ:v.z};
}

type Projected={x:number;y:number;z:number;invW:number;worldX:number;worldY:number;worldZ:number};

function triangleAt(page:VisPage,triangleIndex:number,viewProj:THREE.Matrix4,width:number,height:number){
 const index=page.array,position=page.attributes.position,base=triangleIndex*3;
 if(!position||base+2>=index.length)return null;
 const a=project(page.matrix,position,index[base],viewProj,width,height);
 const b=project(page.matrix,position,index[base+1],viewProj,width,height);
 const c=project(page.matrix,position,index[base+2],viewProj,width,height);
 if(!a||!b||!c)return null;
 return {a,b,c,page,triangleIndex,i0:index[base],i1:index[base+1],i2:index[base+2]};
}

function barycentric(a:Projected,b:Projected,c:Projected,x:number,y:number){
 const area=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);if(area===0)return null;
 const w0=((b.x-x)*(c.y-y)-(c.x-x)*(b.y-y))/area,w1=((c.x-x)*(a.y-y)-(a.x-x)*(c.y-y))/area,w2=1-w0-w1;
 if(w0<0||w1<0||w2<0)return null;
 return {w0,w1,w2,area};
}

function perspectiveBary(a:Projected,b:Projected,c:Projected,affine:{w0:number;w1:number;w2:number}){
 const a0=affine.w0*a.invW,a1=affine.w1*b.invW,a2=affine.w2*c.invW,sum=a0+a1+a2;
 if(sum===0)return affine;
 return {w0:a0/sum,w1:a1/sum,w2:a2/sum};
}

function attr2(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute|undefined,i0:number,i1:number,i2:number,w0:number,w1:number,w2:number):[number,number]{
 if(!attribute)return [0,0];
 return [attribute.getX(i0)*w0+attribute.getX(i1)*w1+attribute.getX(i2)*w2,attribute.getY(i0)*w0+attribute.getY(i1)*w1+attribute.getY(i2)*w2];
}

function attr3(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute|undefined,i0:number,i1:number,i2:number,w0:number,w1:number,w2:number):[number,number,number]{
 if(!attribute)return [0,0,0];
 return [attribute.getX(i0)*w0+attribute.getX(i1)*w1+attribute.getX(i2)*w2,attribute.getY(i0)*w0+attribute.getY(i1)*w1+attribute.getY(i2)*w2,attribute.getZ(i0)*w0+attribute.getZ(i1)*w1+attribute.getZ(i2)*w2];
}

function wrapTexel(t:number,size:number,wrap:THREE.Wrapping){
 const scaled=wrap===THREE.ClampToEdgeWrapping?Math.min(1,Math.max(0,t)):t-Math.floor(t);
 return Math.min(size-1,Math.max(0,Math.floor(scaled*size)));
}

function srgbToLinear(c:number){return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function linearToSrgb8(c:number){const s=c<=0.0031308?12.92*c:1.055*Math.pow(Math.max(c,0),1/2.4)-0.055;return Math.max(0,Math.min(255,Math.round(s*255)));}

function sampleMap(map:THREE.Texture,u:number,v:number):[number,number,number]{
 const image=textureRgba(map);if(!image)return [1,1,1];
 const x=wrapTexel(u,image.width,map.wrapS),y=wrapTexel(v,image.height,map.wrapT),i=(y*image.width+x)*4,d=image.data;
 return [srgbToLinear(d[i]/255),srgbToLinear(d[i+1]/255),srgbToLinear(d[i+2]/255)];
}

export function clusterHash(id:string){
 return Array.from(id).reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,0);
}

function uvDerivatives(a:Projected,b:Projected,c:Projected,uva:[number,number],uvb:[number,number],uvc:[number,number]){
 const dxb=b.x-a.x,dyb=b.y-a.y,dxc=c.x-a.x,dyc=c.y-a.y,det=dxb*dyc-dxc*dyb;
 if(det===0)return {duDx:0,dvDx:0,duDy:0,dvDy:0};
 const inv=1/det,dsdx=dyc*inv,dsdy=-dxc*inv,dtdx=-dyb*inv,dtdy=dxb*inv;
 const dux=uvb[0]-uva[0],duy=uvc[0]-uva[0],dvx=uvb[1]-uva[1],dvy=uvc[1]-uva[1];
 return {duDx:dux*dsdx+duy*dtdx,dvDx:dvx*dsdx+dvy*dtdx,duDy:dux*dsdy+duy*dtdy,dvDy:dvx*dsdy+dvy*dtdy};
}

function fillIds(ids:Uint32Array,depth:Float32Array,width:number,height:number,a:Projected,b:Projected,c:Projected,packed:number){
 const area=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
 if(area===0)return;
 const minX=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),maxX=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x)));
 const minY=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),maxY=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
 const ax=a.x,ay=a.y,az=a.z;
 const bx=b.x,by=b.y,bz=b.z;
 const cx=c.x,cy=c.y,cz=c.z;
 for(let y=minY;y<=maxY;y++){
  const cy_y=cy-y,by_y=by-y,ay_y=ay-y;
  const row=y*width;
  for(let x=minX;x<=maxX;x++){
   const bx_x=bx-x,cx_x=cx-x;
   const w0=(bx_x*cy_y-cx_x*by_y)/area;
   if(w0<0)continue;
   const ax_x=ax-x;
   const w1=(cx_x*ay_y-ax_x*cy_y)/area;
   if(w1<0)continue;
   const w2=1-w0-w1;
   if(w2<0)continue;
   const z=w0*az+w1*bz+w2*cz,o=row+x;
   if(z>=depth[o])continue;
   depth[o]=z;ids[o]=packed;
  }
 }
}

/** CPU visbuffer: packed IDs plus NDC z (background 1). Closest z wins; equal z keeps the first write. */
export function rasterVisibility(pages:VisPage[],camera:THREE.PerspectiveCamera,viewport:[number,number]){
 const [width,height]=viewport,ids=new Uint32Array(width*height),depth=new Float32Array(width*height);
 depth.fill(Infinity);
 camera.updateMatrixWorld();
 const viewProj=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 for(let pageIndex=0;pageIndex<pages.length&&pageIndex<=0xfffe;pageIndex++){
  const page=pages[pageIndex],index=page.array;if(!page.attributes.position)continue;
  const side=visMaterial(page.material).doubleSided?THREE.DoubleSide:(Array.isArray(page.material)?page.material[0].side:page.material.side);
  const triangles=Math.min((index.length/3)|0,0xffff+1);
  for(let t=0;t<triangles&&t<=0xffff;t++){
   const tri=triangleAt(page,t,viewProj,width,height);if(!tri)continue;
   const area=(tri.b.x-tri.a.x)*(tri.c.y-tri.a.y)-(tri.c.x-tri.a.x)*(tri.b.y-tri.a.y);
   if(side!==THREE.DoubleSide){
    if(side===THREE.BackSide){if(area<=0)continue;}
    else if(area>=0)continue;
   }
   fillIds(ids,depth,width,height,tri.a,tri.b,tri.c,packVisibilityId(pageIndex,t));
  }
 }
 for(let i=0;i<depth.length;i++)if(depth[i]===Infinity)depth[i]=HIZ_BACKGROUND;
 return {ids,depth};
}

export function rasterVisibilityIds(pages:VisPage[],camera:THREE.PerspectiveCamera,viewport:[number,number]){
 return rasterVisibility(pages,camera,viewport).ids;
}

function shadePixel(id:number,pages:VisPage[],camera:THREE.PerspectiveCamera,viewProj:THREE.Matrix4,width:number,height:number,x:number,y:number):[number,number,number]{
 const unpacked=unpackVisibilityId(id);if(!unpacked)return backgroundRgb() as [number,number,number];
 const page=pages[unpacked.pageIndex];if(!page)return backgroundRgb() as [number,number,number];
 const tri=triangleAt(page,unpacked.triangleIndex,viewProj,width,height);if(!tri)return backgroundRgb() as [number,number,number];
 const affine=barycentric(tri.a,tri.b,tri.c,x,y);if(!affine)return backgroundRgb() as [number,number,number];
 const bary=perspectiveBary(tri.a,tri.b,tri.c,affine);
 const uv=attr2(page.attributes.uv,tri.i0,tri.i1,tri.i2,bary.w0,bary.w1,bary.w2);
 const mat=visMaterial(page.material);
 let rgb: [number,number,number]=[mat.baseColor[0],mat.baseColor[1],mat.baseColor[2]];
 if(mat.map){const sample=sampleMap(mat.map,uv[0],uv[1]);rgb=[rgb[0]*sample[0],rgb[1]*sample[1],rgb[2]*sample[2]];}
 const encode=(c:[number,number,number]):[number,number,number]=>mat.map||mat.lit?[linearToSrgb8(c[0]),linearToSrgb8(c[1]),linearToSrgb8(c[2])]:[Math.max(0,Math.min(255,c[0]*255))|0,Math.max(0,Math.min(255,c[1]*255))|0,Math.max(0,Math.min(255,c[2]*255))|0];
 if(mat.lit){
  const world:[number,number,number]=[tri.a.worldX*bary.w0+tri.b.worldX*bary.w1+tri.c.worldX*bary.w2,tri.a.worldY*bary.w0+tri.b.worldY*bary.w1+tri.c.worldY*bary.w2,tri.a.worldZ*bary.w0+tri.b.worldZ*bary.w1+tri.c.worldZ*bary.w2];
  let nx=tri.b.worldX-tri.a.worldX,ny=tri.b.worldY-tri.a.worldY,nz=tri.b.worldZ-tri.a.worldZ;
  const cx=tri.c.worldX-tri.a.worldX,cy=tri.c.worldY-tri.a.worldY,cz=tri.c.worldZ-tri.a.worldZ;
  let Nx=ny*cz-nz*cy,Ny=nz*cx-nx*cz,Nz=nx*cy-ny*cx;
  const nAttr=page.attributes.normal?attr3(page.attributes.normal,tri.i0,tri.i1,tri.i2,bary.w0,bary.w1,bary.w2):null;
  if(nAttr&&(nAttr[0]||nAttr[1]||nAttr[2])){
   normalScratch.getNormalMatrix(page.matrix);
   const e=normalScratch.elements;
   Nx=e[0]*nAttr[0]+e[3]*nAttr[1]+e[6]*nAttr[2];Ny=e[1]*nAttr[0]+e[4]*nAttr[1]+e[7]*nAttr[2];Nz=e[2]*nAttr[0]+e[5]*nAttr[1]+e[8]*nAttr[2];
  }
  let nLen=Math.hypot(Nx,Ny,Nz);if(nLen===0)nLen=1;Nx/=nLen;Ny/=nLen;Nz/=nLen;
  const vx=camera.position.x-world[0],vy=camera.position.y-world[1],vz=camera.position.z-world[2],vLen=Math.hypot(vx,vy,vz)||1;
  const V=[vx/vLen,vy/vLen,vz/vLen];
  if(Nx*V[0]+Ny*V[1]+Nz*V[2]<0){Nx=-Nx;Ny=-Ny;Nz=-Nz;}
  const Lraw=[1,3,2],lLen=Math.hypot(Lraw[0],Lraw[1],Lraw[2]),L=[Lraw[0]/lLen,Lraw[1]/lLen,Lraw[2]/lLen];
  const NdotL=Math.max(0,Nx*L[0]+Ny*L[1]+Nz*L[2]),up=Ny*0.5+0.5;
  const sky=[2,2,2],ground=[0x49/255*2,0x50/255*2,0x61/255*2];
  const hemi=[ground[0]+(sky[0]-ground[0])*up,ground[1]+(sky[1]-ground[1])*up,ground[2]+(sky[2]-ground[2])*up];
  const kd=1-mat.metalness,direct=2.5*NdotL;
  const hx=L[0]+V[0],hy=L[1]+V[1],hz=L[2]+V[2],hLen=Math.hypot(hx,hy,hz)||1;
  const NdotH=Math.max(0,Nx*hx/hLen+Ny*hy/hLen+Nz*hz/hLen);
  const spec=Math.pow(NdotH,8+(1-mat.roughness)*248)*(0.04+(1-0.04)*mat.metalness)*direct;
  rgb=[rgb[0]*kd*(hemi[0]+direct)+spec*(mat.metalness?rgb[0]:1),rgb[1]*kd*(hemi[1]+direct)+spec*(mat.metalness?rgb[1]:1),rgb[2]*kd*(hemi[2]+direct)+spec*(mat.metalness?rgb[2]:1)];
 }
 return encode(rgb);
}

/** Documented visbuffer beauty: MeshBasicMaterial = source color × map (same 8-bit path as rasterPages). MeshStandardMaterial = Lambert+Blinn with the explorer hemisphere/directional lights, not MeshStandardMaterial pixel-perfect. */
export function shadeVisibility(ids:Uint32Array,pages:VisPage[],camera:THREE.PerspectiveCamera,viewport:[number,number]){
 const [width,height]=viewport,pixels=new Uint8Array(width*height*4);
 camera.updateMatrixWorld();
 const viewProj=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 const bg=backgroundRgb();
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const o=y*width+x,rgb=shadePixel(ids[o],pages,camera,viewProj,width,height,x,y);
  const p=o*4;pixels[p]=rgb[0]??bg[0];pixels[p+1]=rgb[1]??bg[1];pixels[p+2]=rgb[2]??bg[2];pixels[p+3]=255;
 }
 return pixels;
}

/** Analytical UV derivatives of the winning triangle. Not a finite difference across visbuffer discontinuities. */
export function visibilityUvDerivatives(ids:Uint32Array,pages:VisPage[],camera:THREE.PerspectiveCamera,viewport:[number,number],x:number,y:number){
 const [width,height]=viewport,unpacked=unpackVisibilityId(ids[y*width+x]);if(!unpacked)return null;
 camera.updateMatrixWorld();
 const viewProj=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 const page=pages[unpacked.pageIndex];if(!page)return null;
 const tri=triangleAt(page,unpacked.triangleIndex,viewProj,width,height);if(!tri)return null;
 const uv=page.attributes.uv;
 const uva: [number,number]=uv?[uv.getX(tri.i0),uv.getY(tri.i0)]:[0,0];
 const uvb: [number,number]=uv?[uv.getX(tri.i1),uv.getY(tri.i1)]:[0,0];
 const uvc: [number,number]=uv?[uv.getX(tri.i2),uv.getY(tri.i2)]:[0,0];
 return uvDerivatives(tri.a,tri.b,tri.c,uva,uvb,uvc);
}

export const VIS_SHADER=`struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,uvScale:vec2f,clusterHash:u32,hizSlot:u32,}
struct Uniforms{viewProj:mat4x4f,}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read> positions:array<f32>;
@group(0) @binding(2) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage, read> hizFlags:array<u32>;
@group(0) @binding(4) var<uniform> uni:Uniforms;
struct VSOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) id:u32,}
fn vertPos(base:u32,idx:u32)->vec3f{let i=(base+idx)*3u;return vec3f(positions[i],positions[i+1u],positions[i+2u]);}
@vertex fn vis_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let page=pages[instanceIndex];
 if(vertexIndex>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffffu);
 return out;
}
@vertex fn vis_hiz_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let page=pages[instanceIndex];
 if(page.hizSlot!=0xffffffffu&&hizFlags[page.hizSlot]!=0u){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 if(vertexIndex>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffffu);
 return out;
}
struct VisHizOut{@location(0) id:u32,@location(1) depth:f32,}
@fragment fn vis_hiz_fs(in:VSOut)->VisHizOut{var out:VisHizOut;out.id=in.id;out.depth=in.position.z;return out;}
@fragment fn vis_fs(in:VSOut)->@location(0) u32{return in.id;}
`;

export const SHADE_SHADER=`struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,uvScale:vec2f,clusterHash:u32,pad1:u32,}
struct ShadeUni{viewProj:mat4x4f,viewport:vec4f,pageCount:u32,mode:u32,pad0:u32,pad1:u32,camPos:vec4f,lightDir:vec4f,hemiSky:vec4f,hemiGround:vec4f,background:vec4f,pad2:vec4f,pad3:vec4f,pad4:vec4f,pad5:vec4f,pad6:vec4f,}
@group(0) @binding(0) var vis:texture_2d<u32>;
@group(0) @binding(1) var<storage, read> indices:array<u32>;
@group(0) @binding(2) var<storage, read> positions:array<f32>;
@group(0) @binding(3) var<storage, read> uvs:array<f32>;
@group(0) @binding(4) var<storage, read> normals:array<f32>;
@group(0) @binding(5) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(6) var maps:texture_2d_array<f32>;
@group(0) @binding(7) var mapsSampler:sampler;
@group(0) @binding(8) var<uniform> uni:ShadeUni;
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(c,vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}
fn hashColor(id:u32)->vec3f{let x=f32(id);return fract(sin(vec3f(x,x*1.37,x*2.17)*vec3f(12.9898,78.233,45.164))*43758.5453);}
fn vertPos(base:u32,idx:u32)->vec3f{let i=(base+idx)*3u;return vec3f(positions[i],positions[i+1u],positions[i+2u]);}
fn vertUv(base:u32,idx:u32)->vec2f{let i=(base+idx)*2u;return vec2f(uvs[i],uvs[i+1u]);}
fn vertN(base:u32,idx:u32)->vec3f{let i=(base+idx)*3u;return vec3f(normals[i],normals[i+1u],normals[i+2u]);}
fn edge(a:vec2f,b:vec2f,p:vec2f)->f32{return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}
fn wrapCoord(t:f32,repeat:bool)->f32{return select(clamp(t,0.0,1.0),fract(t),repeat);}
fn xformNormal(world:mat4x4f,n:vec3f)->vec3f{
 let m=mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz);
 if(determinant(m)==0.0){return n;}
 return normalize(transpose(inverse(m))*n);
}
fn framebuffer(clip:vec4f)->vec3f{
 let ndc=clip.xyz/clip.w;
 return vec3f((ndc.x*0.5+0.5)*uni.viewport.x,(-ndc.y*0.5+0.5)*uni.viewport.y,ndc.z);
}
@vertex fn shade_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let x=f32(i32(i&1u)*4-1);let y=f32(i32(i>>1u)*4-1);return vec4f(x,y,0.0,1.0);
}
@fragment fn shade_fs(@builtin(position) pos:vec4f)->@location(0) vec4f{
 let coord=vec2<i32>(i32(pos.x),i32(pos.y));
 let id=textureLoad(vis,coord,0).r;
 if(id==0u){return uni.background;}
 let pageIndex=(id>>16u)-1u;let tri=id&0xffffu;
 if(pageIndex>=uni.pageCount){return uni.background;}
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount){return uni.background;}
 let base=page.pageOffset+tri*3u;
 let i0=indices[base];let i1=indices[base+1u];let i2=indices[base+2u];
 let p0=vertPos(page.vertexBase,i0);let p1=vertPos(page.vertexBase,i1);let p2=vertPos(page.vertexBase,i2);
 let w0=page.world*vec4f(p0,1.0);let w1=page.world*vec4f(p1,1.0);let w2=page.world*vec4f(p2,1.0);
 let c0=uni.viewProj*w0;let c1=uni.viewProj*w1;let c2=uni.viewProj*w2;
 let s0=framebuffer(c0);let s1=framebuffer(c1);let s2=framebuffer(c2);
 let p=vec2f(pos.x,pos.y);
 let area=edge(s1.xy,s2.xy,s0.xy);
 var rgb=page.baseColor.xyz;
 var bary=vec3f(0.333,0.333,0.334);
 var uv=vec2f(0.0);
 if(area!=0.0){
  let a0=edge(s1.xy,s2.xy,p)/area;let a1=edge(s2.xy,s0.xy,p)/area;let a2=1.0-a0-a1;
  let iw0=1.0/c0.w;let iw1=1.0/c1.w;let iw2=1.0/c2.w;
  let p0w=a0*iw0;let p1w=a1*iw1;let p2w=a2*iw2;let sum=p0w+p1w+p2w;
  bary=select(vec3f(a0,a1,a2),vec3f(p0w,p1w,p2w)/sum,sum!=0.0);
 }
 if((page.flags&4u)!=0u){
  uv=vertUv(page.vertexBase,i0)*bary.x+vertUv(page.vertexBase,i1)*bary.y+vertUv(page.vertexBase,i2)*bary.z;
 }
 if((page.flags&8u)!=0u){
  let uva=vertUv(page.vertexBase,i0);let uvb=vertUv(page.vertexBase,i1);let uvc=vertUv(page.vertexBase,i2);
  let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
  var ddx=vec2f(0.0);var ddy=vec2f(0.0);
  if(det!=0.0){
   let inv=1.0/det;
   ddx=((uvb-uva)*dyc-(uvc-uva)*dyb)*inv;
   ddy=((uvc-uva)*dxb-(uvb-uva)*dxc)*inv;
  }
  let wrapped=vec2f(wrapCoord(uv.x,(page.flags&32u)!=0u),wrapCoord(uv.y,(page.flags&64u)!=0u))*page.uvScale;
  let sample=textureSampleGrad(maps,mapsSampler,wrapped,i32(page.mapIndex),ddx*page.uvScale,ddy*page.uvScale);
  rgb=rgb*sample.xyz;
 }
 if(uni.mode==1u){
  let width=fwidth(bary);
  let edgeW=1.0-min(min(smoothstep(0.0,width.x*1.2,bary.x),smoothstep(0.0,width.y*1.2,bary.y)),smoothstep(0.0,width.z*1.2,bary.z));
  return vec4f(mix(hashColor(id)*0.7,vec3f(0.04,0.05,0.07),edgeW),1.0);
 }
 if(uni.mode==2u){return vec4f(hashColor(page.clusterHash),1.0);}
 if(uni.mode==3u){return vec4f(0.204,0.827,0.6,1.0);}
 if((page.flags&1u)!=0u){
  var N=normalize(cross((w1-w0).xyz,(w2-w0).xyz));
  if((page.flags&16u)!=0u){
   let na=vertN(page.vertexBase,i0)*bary.x+vertN(page.vertexBase,i1)*bary.y+vertN(page.vertexBase,i2)*bary.z;
   if(dot(na,na)>0.0){N=xformNormal(page.world,na);}
  }
  let world=w0.xyz*bary.x+w1.xyz*bary.y+w2.xyz*bary.z;
  let V=normalize(uni.camPos.xyz-world);
  if(dot(N,V)<0.0){N=-N;}
  let L=normalize(uni.lightDir.xyz);
  let NdotL=max(dot(N,L),0.0);
  let up=N.y*0.5+0.5;
  let hemi=mix(uni.hemiGround.xyz,uni.hemiSky.xyz,up);
  let direct=uni.lightDir.w*NdotL;
  let H=normalize(L+V);
  let spec=pow(max(dot(N,H),0.0),8.0+(1.0-page.roughness)*248.0)*(0.04+0.96*page.metalness)*direct;
  let kd=1.0-page.metalness;
  rgb=rgb*kd*(hemi+vec3f(direct))+vec3f(spec)*select(vec3f(1.0),rgb,page.metalness>0.0);
  return vec4f(linearToSrgb(aces(rgb)),1.0);
 }
 return vec4f(linearToSrgb(aces(rgb)),1.0);
}
`;
