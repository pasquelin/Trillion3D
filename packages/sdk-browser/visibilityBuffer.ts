import {NORMAL_TRANSFORM_WGSL} from './standardLighting.ts';
import * as THREE from 'three';
import {HIZ_BACKGROUND} from '../sdk-core/index.ts';
import {RASTER_BACKGROUND} from './pageRaster.ts';

export const VIS_INVALID=0;
export const PAGE_INFO_STRIDE=256;
export const FLAG_LIT=1,FLAG_DOUBLE=2,FLAG_HAS_UV=4,FLAG_HAS_MAP=8,FLAG_HAS_NORMAL=16,FLAG_WRAP_S_REPEAT=32,FLAG_WRAP_T_REPEAT=64,FLAG_MASK=128,FLAG_BACK=256,FLAG_HAS_ORM=512,FLAG_HAS_NORMAL_MAP=1024,FLAG_HAS_TANGENT=2048;
const normalScratch=new THREE.Matrix3();
const projectScratch=new THREE.Vector3();
// CPU diagnostic oracle: reuse its tangent frame instead of allocating per pixel.
const frameNormals=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
const frameTangents=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
const frameBitangents=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
const frameN=new THREE.Vector3(),frameT=new THREE.Vector3(),frameB=new THREE.Vector3(),frameQ=new THREE.Vector3();

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
 backSide:boolean;
 alphaTest:number;
 map?:THREE.Texture;
 metalnessMap?:THREE.Texture;
 roughnessMap?:THREE.Texture;
 normalMap?:THREE.Texture;
 normalScale:number;
 normalScaleY:number;
 aoMap?:THREE.Texture;
 aoIntensity:number;
 emissive:[number,number,number];
 emissiveMap?:THREE.Texture;
 transmission:number;
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
 const phys=first as THREE.MeshPhysicalMaterial;
 const lit=!!std.isMeshStandardMaterial;
 return {
  baseColor:[color.r,color.g,color.b],
  metalness:lit?std.metalness:0,
  roughness:lit?std.roughness:1,
  lit,
  doubleSided:first.side===THREE.DoubleSide,
  backSide:first.side===THREE.BackSide,
  alphaTest:'alphaTest' in first&&typeof first.alphaTest==='number'?first.alphaTest:0,
  map:'map' in first&&first.map?first.map as THREE.Texture:undefined,
  metalnessMap:lit&&std.metalnessMap?std.metalnessMap:undefined,
  roughnessMap:lit&&std.roughnessMap?std.roughnessMap:undefined,
  normalMap:lit&&std.normalMap?std.normalMap:undefined,
  normalScale:lit&&std.normalScale?std.normalScale.x:1,
  normalScaleY:lit&&std.normalScale?std.normalScale.y:1,
  aoMap:lit&&std.aoMap?std.aoMap:undefined,
  aoIntensity:lit?std.aoMapIntensity:1,
  emissive:lit?[std.emissive.r*std.emissiveIntensity,std.emissive.g*std.emissiveIntensity,std.emissive.b*std.emissiveIntensity]:[0,0,0],
  emissiveMap:lit&&std.emissiveMap?std.emissiveMap:undefined,
  transmission:phys.isMeshPhysicalMaterial&&typeof phys.transmission==='number'?phys.transmission:0,
 };
}

/** Transmission/volume cannot be reconstructed from a visbuffer ID; keep the source mesh on the forward path. */
export function isTransmissive(material:THREE.Material|THREE.Material[]){
 return visMaterial(material).transmission>0;
}

export function textureRgba(texture:THREE.Texture):{data:Uint8Array;width:number;height:number}|null{
 const image=texture.image as {data?:ArrayBufferView;width?:number;height?:number}|undefined;
 if(!image?.data||!image.width||!image.height)return null;
 const src=image.data;
 return {data:new Uint8Array(src.buffer,src.byteOffset,src.byteLength),width:image.width,height:image.height};
}

function backgroundRgb(background:number){return [(background>>16)&255,(background>>8)&255,background&255];}

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

function sampleTexel(map:THREE.Texture,u:number,v:number):[number,number,number,number]|null{
 const image=textureRgba(map);if(!image)return null;
 const x=wrapTexel(u,image.width,map.wrapS),y=wrapTexel(v,image.height,map.wrapT),i=(y*image.width+x)*4,d=image.data;
 return [d[i]/255,d[i+1]/255,d[i+2]/255,d[i+3]/255];
}
function sampleMap(map:THREE.Texture,u:number,v:number):[number,number,number]{
 const texel=sampleTexel(map,u,v);if(!texel)return [1,1,1];
 return [srgbToLinear(texel[0]),srgbToLinear(texel[1]),srgbToLinear(texel[2])];
}
function sampleLinear(map:THREE.Texture,u:number,v:number):[number,number,number]{
 const texel=sampleTexel(map,u,v);if(!texel)return [1,1,1];
 return [texel[0],texel[1],texel[2]];
}

export function clusterHash(id:string){
 return Array.from(id).reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,0);
}

function uvDerivatives(a:Projected,b:Projected,c:Projected,uva:[number,number],uvb:[number,number],uvc:[number,number],x:number,y:number){
 const dxb=b.x-a.x,dyb=b.y-a.y,dxc=c.x-a.x,dyc=c.y-a.y,det=dxb*dyc-dxc*dyb;
 if(det===0)return {duDx:0,dvDx:0,duDy:0,dvDy:0};
 const inv=1/det,dsdx=dyc*inv,dsdy=-dxc*inv,dtdx=-dyb*inv,dtdy=dxb*inv;
 const s=((x-a.x)*dyc-(y-a.y)*dxc)*inv,t=((y-a.y)*dxb-(x-a.x)*dyb)*inv,a0=1-s-t;
 const iw0=a.invW,iw1=b.invW,iw2=c.invW;
 const Uu=a0*uva[0]*iw0+s*uvb[0]*iw1+t*uvc[0]*iw2,Uv=a0*uva[1]*iw0+s*uvb[1]*iw1+t*uvc[1]*iw2,W=a0*iw0+s*iw1+t*iw2;
 if(W===0)return {duDx:0,dvDx:0,duDy:0,dvDy:0};
 const dUuds=-uva[0]*iw0+uvb[0]*iw1,dUudt=-uva[0]*iw0+uvc[0]*iw2,dUvds=-uva[1]*iw0+uvb[1]*iw1,dUvdt=-uva[1]*iw0+uvc[1]*iw2;
 const dWds=-iw0+iw1,dWdt=-iw0+iw2;
 const dUudx=dUuds*dsdx+dUudt*dtdx,dUudy=dUuds*dsdy+dUudt*dtdy,dUvdx=dUvds*dsdx+dUvdt*dtdx,dUvdy=dUvds*dsdy+dUvdt*dtdy;
 const dWdx=dWds*dsdx+dWdt*dtdx,dWdy=dWds*dsdy+dWdt*dtdy,invW2=1/(W*W);
 return {duDx:(dUudx*W-Uu*dWdx)*invW2,dvDx:(dUvdx*W-Uv*dWdx)*invW2,duDy:(dUudy*W-Uu*dWdy)*invW2,dvDy:(dUvdy*W-Uv*dWdy)*invW2};
}

function fillIds(ids:Uint32Array,depth:Float32Array,width:number,height:number,a:Projected,b:Projected,c:Projected,packed:number,keep?:(x:number,y:number,w0:number,w1:number,w2:number)=>boolean){
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
   if(keep&&!keep(x,y,w0,w1,w2))continue;
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
   const mat=visMaterial(page.material);
   if(mat.alphaTest>0&&mat.map){
    const uv=page.attributes.uv;
    fillIds(ids,depth,width,height,tri.a,tri.b,tri.c,packVisibilityId(pageIndex,t),(x,y,w0,w1,w2)=>{
     const bary=perspectiveBary(tri.a,tri.b,tri.c,{w0,w1,w2});
     const u=uv?uv.getX(tri.i0)*bary.w0+uv.getX(tri.i1)*bary.w1+uv.getX(tri.i2)*bary.w2:0;
     const v=uv?uv.getY(tri.i0)*bary.w0+uv.getY(tri.i1)*bary.w1+uv.getY(tri.i2)*bary.w2:0;
     const rgba=textureRgba(mat.map!);if(!rgba)return true;
     const tx=wrapTexel(u,rgba.width,mat.map!.wrapS),ty=wrapTexel(v,rgba.height,mat.map!.wrapT);
     return rgba.data[(ty*rgba.width+tx)*4+3]/255>=mat.alphaTest;
    });
    continue;
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

function shadePixel(id:number,pages:VisPage[],camera:THREE.PerspectiveCamera,viewProj:THREE.Matrix4,width:number,height:number,x:number,y:number,background:number):[number,number,number]{
 const unpacked=unpackVisibilityId(id);if(!unpacked)return backgroundRgb(background) as [number,number,number];
 const page=pages[unpacked.pageIndex];if(!page)return backgroundRgb(background) as [number,number,number];
 const tri=triangleAt(page,unpacked.triangleIndex,viewProj,width,height);if(!tri)return backgroundRgb(background) as [number,number,number];
 const affine=barycentric(tri.a,tri.b,tri.c,x,y);if(!affine)return backgroundRgb(background) as [number,number,number];
 const bary=perspectiveBary(tri.a,tri.b,tri.c,affine);
 const uv=attr2(page.attributes.uv,tri.i0,tri.i1,tri.i2,bary.w0,bary.w1,bary.w2);
 const mat=visMaterial(page.material);
 let rgb: [number,number,number]=[mat.baseColor[0],mat.baseColor[1],mat.baseColor[2]];
 if(mat.map){const sample=sampleMap(mat.map,uv[0],uv[1]);rgb=[rgb[0]*sample[0],rgb[1]*sample[1],rgb[2]*sample[2]];}
 let metalness=mat.metalness,roughness=mat.roughness;
 if(mat.metalnessMap)metalness=Math.min(1,Math.max(0,metalness*sampleLinear(mat.metalnessMap,uv[0],uv[1])[2]));
 if(mat.roughnessMap)roughness=Math.min(1,Math.max(0,roughness*sampleLinear(mat.roughnessMap,uv[0],uv[1])[1]));
 const encode=(c:[number,number,number]):[number,number,number]=>mat.map||mat.lit?[linearToSrgb8(c[0]),linearToSrgb8(c[1]),linearToSrgb8(c[2])]:[Math.max(0,Math.min(255,c[0]*255))|0,Math.max(0,Math.min(255,c[1]*255))|0,Math.max(0,Math.min(255,c[2]*255))|0];
 if(mat.lit){
  const world:[number,number,number]=[tri.a.worldX*bary.w0+tri.b.worldX*bary.w1+tri.c.worldX*bary.w2,tri.a.worldY*bary.w0+tri.b.worldY*bary.w1+tri.c.worldY*bary.w2,tri.a.worldZ*bary.w0+tri.b.worldZ*bary.w1+tri.c.worldZ*bary.w2];
  let nx=tri.b.worldX-tri.a.worldX,ny=tri.b.worldY-tri.a.worldY,nz=tri.b.worldZ-tri.a.worldZ;
  const cx=tri.c.worldX-tri.a.worldX,cy=tri.c.worldY-tri.a.worldY,cz=tri.c.worldZ-tri.a.worldZ;
  let Nx=ny*cz-nz*cy,Ny=nz*cx-nx*cz,Nz=nx*cy-ny*cx;
  const screenFace=affine.area*tri.a.invW*tri.b.invW*tri.c.invW<0?1:-1;
  const face=screenFace*(page.matrix.determinant()<0?-1:1),side=mat.backSide?-1:1;
  const normalAttr=page.attributes.normal,tangentAttr=page.attributes.tangent;
  normalScratch.getNormalMatrix(page.matrix);
  const vertexNormals=normalAttr?frameNormals:null;
  if(normalAttr)for(let j=0;j<3;j++)frameNormals[j].fromBufferAttribute(normalAttr,j===0?tri.i0:j===1?tri.i1:tri.i2).applyMatrix3(normalScratch).normalize().multiplyScalar(side);
  if(vertexNormals){
   const n=frameN.copy(vertexNormals[0]).multiplyScalar(bary.w0).addScaledVector(vertexNormals[1],bary.w1).addScaledVector(vertexNormals[2],bary.w2).normalize();
   if(mat.doubleSided)n.multiplyScalar(face);Nx=n.x;Ny=n.y;Nz=n.z;
  }else{const length=Math.hypot(Nx,Ny,Nz)||1;Nx*=screenFace/length;Ny*=screenFace/length;Nz*=screenFace/length;}
  if(mat.normalMap){
   const nrm=sampleLinear(mat.normalMap,uv[0],uv[1]);
   const mapN=[(nrm[0]*2-1)*mat.normalScale,(nrm[1]*2-1)*mat.normalScaleY,nrm[2]*2-1];
   let T:THREE.Vector3,B:THREE.Vector3;
   if(tangentAttr&&vertexNormals){
    const tangents=frameTangents,bitangents=frameBitangents;
    for(let j=0;j<3;j++){const i=j===0?tri.i0:j===1?tri.i1:tri.i2;tangents[j].fromBufferAttribute(tangentAttr,i).transformDirection(page.matrix).multiplyScalar(side);bitangents[j].crossVectors(vertexNormals[j],tangents[j]).multiplyScalar(tangentAttr.getW(i)).normalize();}
    T=frameT.copy(tangents[0]).multiplyScalar(bary.w0).addScaledVector(tangents[1],bary.w1).addScaledVector(tangents[2],bary.w2).normalize();
    B=frameB.copy(bitangents[0]).multiplyScalar(bary.w0).addScaledVector(bitangents[1],bary.w1).addScaledVector(bitangents[2],bary.w2).normalize();
   }else{
    const uva=attr2(page.attributes.uv,tri.i0,tri.i1,tri.i2,1,0,0),uvb=attr2(page.attributes.uv,tri.i0,tri.i1,tri.i2,0,1,0),uvc=attr2(page.attributes.uv,tri.i0,tri.i1,tri.i2,0,0,1);
    const du1=uvb[0]-uva[0],dv1=uvb[1]-uva[1],du2=uvc[0]-uva[0],dv2=uvc[1]-uva[1];
    const q1=frameN.set(cy*Nz-cz*Ny,cz*Nx-cx*Nz,cx*Ny-cy*Nx);
    const q0=frameQ.set(Ny*nz-Nz*ny,Nz*nx-Nx*nz,Nx*ny-Ny*nx);
    T=frameT.copy(q1).multiplyScalar(du1).addScaledVector(q0,du2);B=frameB.copy(q1).multiplyScalar(dv1).addScaledVector(q0,dv2);
    const scale=screenFace/Math.sqrt(Math.max(T.lengthSq(),B.lengthSq(),1e-20));T.multiplyScalar(scale);B.multiplyScalar(scale);
   }
   if(mat.doubleSided&&normalAttr){T.multiplyScalar(face);B.multiplyScalar(face);}
   const n=T.multiplyScalar(mapN[0]).addScaledVector(B,mapN[1]).addScaledVector(frameN.set(Nx,Ny,Nz),mapN[2]).normalize();Nx=n.x;Ny=n.y;Nz=n.z;
  }
  const vx=camera.position.x-world[0],vy=camera.position.y-world[1],vz=camera.position.z-world[2],vLen=Math.hypot(vx,vy,vz)||1;
  const V=[vx/vLen,vy/vLen,vz/vLen];
  const Lraw=[1,3,2],lLen=Math.hypot(Lraw[0],Lraw[1],Lraw[2]),L=[Lraw[0]/lLen,Lraw[1]/lLen,Lraw[2]/lLen];
  const NdotL=Math.max(0,Nx*L[0]+Ny*L[1]+Nz*L[2]),up=Ny*0.5+0.5;
  const groundColor=new THREE.Color(0x495061);
  const sky=[2,2,2],ground=[groundColor.r*2,groundColor.g*2,groundColor.b*2];
  const hemi=[ground[0]+(sky[0]-ground[0])*up,ground[1]+(sky[1]-ground[1])*up,ground[2]+(sky[2]-ground[2])*up];
   const NdotV=Math.max(1e-4,Nx*V[0]+Ny*V[1]+Nz*V[2]);
   const hx=L[0]+V[0],hy=L[1]+V[1],hz=L[2]+V[2],hLen=Math.hypot(hx,hy,hz)||1;
   const H=[hx/hLen,hy/hLen,hz/hLen];
   const NdotH=Math.max(0,Nx*H[0]+Ny*H[1]+Nz*H[2]);
   const VdotH=Math.max(0,V[0]*H[0]+V[1]*H[1]+V[2]*H[2]);
   const alpha=Math.max(0.0525,roughness)**2;
   const alpha2=alpha*alpha;
   const dDenom=NdotH*NdotH*(alpha2-1)+1;
   const D=alpha2/(Math.PI*dDenom*dDenom);
   const gV=NdotL*Math.sqrt(NdotV*NdotV*(1-alpha2)+alpha2);
   const gL=NdotV*Math.sqrt(NdotL*NdotL*(1-alpha2)+alpha2);
   const Vis=0.5/(gV+gL+1e-7);
   const f0=[0.04*(1-metalness)+rgb[0]*metalness, 0.04*(1-metalness)+rgb[1]*metalness, 0.04*(1-metalness)+rgb[2]*metalness];
   const fTerm=Math.pow(Math.max(0,1-VdotH),5);
   const F=[f0[0]+(1-f0[0])*fTerm, f0[1]+(1-f0[1])*fTerm, f0[2]+(1-f0[2])*fTerm];
   const spec=[D*Vis*F[0], D*Vis*F[1], D*Vis*F[2]];
   const direct=2.5*NdotL;
   const diffuse=rgb.map(c=>c*(1-metalness)/Math.PI);
   const ao=mat.aoMap?1+mat.aoIntensity*(sampleLinear(mat.aoMap,uv[0],uv[1])[0]-1):1;
   const emissiveSample=mat.emissiveMap?sampleMap(mat.emissiveMap,uv[0],uv[1]):[1,1,1];
   rgb=[0,1,2].map(c=>diffuse[c]*(hemi[c]*ao+direct)+spec[c]*direct+mat.emissive[c]*emissiveSample[c]) as [number,number,number];
  }
  return encode(rgb);
}

/** Documented visbuffer beauty: MeshBasicMaterial = source color × map (same 8-bit path as rasterPages). MeshStandardMaterial = Cook-Torrance GGX microfacet BRDF with the explorer hemisphere/directional lights. */
export function shadeVisibility(ids:Uint32Array,pages:VisPage[],camera:THREE.PerspectiveCamera,viewport:[number,number],background=RASTER_BACKGROUND){
 const [width,height]=viewport,pixels=new Uint8Array(width*height*4);
 camera.updateMatrixWorld();
 const viewProj=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 const bg=backgroundRgb(background);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const o=y*width+x,rgb=shadePixel(ids[o],pages,camera,viewProj,width,height,x,y,background);
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
 return uvDerivatives(tri.a,tri.b,tri.c,uva,uvb,uvc,x,y);
}

export const VIS_SHADER=`struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,uvScale:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,roughUvScale:vec2f,metalUvScale:vec2f,normalUvScale:vec2f,aoIndex:u32,aoIntensity:f32,aoUvScale:vec2f,emissiveIndex:u32,pad0:u32,emissive:vec4f,emissiveUvScale:vec2f,normalScaleY:f32,pad1:f32,pad4:vec4f,pad5:vec4f,}
struct Uniforms{viewProj:mat4x4f,}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read> positions:array<f32>;
@group(0) @binding(2) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage, read> hizFlags:array<u32>;
@group(0) @binding(4) var<uniform> uni:Uniforms;
@group(0) @binding(5) var<storage, read> uvs:array<f32>;
@group(0) @binding(6) var maps:texture_2d_array<f32>;
@group(0) @binding(7) var mapsSampler:sampler;
struct VSOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) id:u32,@location(1) @interpolate(flat) instance:u32,@location(2) uv:vec2f,}
fn vertPos(base:u32,idx:u32)->vec3f{let i=(base+idx)*3u;return vec3f(positions[i],positions[i+1u],positions[i+2u]);}
fn vertUv(base:u32,idx:u32)->vec2f{let i=(base+idx)*2u;return vec2f(uvs[i],uvs[i+1u]);}
fn wrapCoord(t:f32,repeat:bool)->f32{return select(clamp(t,0.0,1.0),fract(t),repeat);}
fn maskKeep(page:PageInfo,uv:vec2f)->bool{
 if((page.flags&128u)==0u||(page.flags&8u)==0u){return true;}
 let wrapped=vec2f(wrapCoord(uv.x,(page.flags&32u)!=0u),wrapCoord(uv.y,(page.flags&64u)!=0u))*page.uvScale;
 let sample=textureSampleLevel(maps,mapsSampler,wrapped,i32(page.mapIndex),0.0);
 return sample.w>=page.baseColor.w;
}
@vertex fn vis_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let page=pages[instanceIndex];
 out.instance=instanceIndex;out.uv=vec2f(0.0);
 if(vertexIndex>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffffu);
 if((page.flags&4u)!=0u){out.uv=vertUv(page.vertexBase,id);}
 return out;
}
@vertex fn vis_hiz_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let page=pages[instanceIndex];
 out.instance=instanceIndex;out.uv=vec2f(0.0);
 if(page.hizSlot!=0xffffffffu&&hizFlags[page.hizSlot]!=0u){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 if(vertexIndex>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffffu);
 if((page.flags&4u)!=0u){out.uv=vertUv(page.vertexBase,id);}
 return out;
}
struct VisHizOut{@location(0) id:u32,@location(1) depth:f32,}
@fragment fn vis_hiz_fs(in:VSOut)->VisHizOut{
 var out:VisHizOut;
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
 out.id=in.id;out.depth=in.position.z;return out;
}
@fragment fn vis_fs(in:VSOut)->@location(0) u32{
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
 return in.id;
}
`;

export const SHADE_SHADER=`struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,uvScale:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,roughUvScale:vec2f,metalUvScale:vec2f,normalUvScale:vec2f,aoIndex:u32,aoIntensity:f32,aoUvScale:vec2f,emissiveIndex:u32,pad0:u32,emissive:vec4f,emissiveUvScale:vec2f,normalScaleY:f32,pad1:f32,pad4:vec4f,pad5:vec4f,}
struct ShadeUni{viewProj:mat4x4f,viewport:vec4f,pageCount:u32,mode:u32,pad0:u32,pad1:u32,padding:array<vec4f,10>,}
@group(0) @binding(0) var vis:texture_2d<u32>;
@group(0) @binding(1) var<storage, read> indices:array<u32>;
@group(0) @binding(2) var<storage, read> positions:array<f32>;
@group(0) @binding(3) var<storage, read> uvs:array<f32>;
@group(0) @binding(4) var<storage, read> normals:array<f32>;
@group(0) @binding(5) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(6) var maps:texture_2d_array<f32>;
@group(0) @binding(7) var mapsSampler:sampler;
@group(0) @binding(8) var<uniform> uni:ShadeUni;
@group(0) @binding(9) var dataMaps:texture_2d_array<f32>;
fn hashColor(id:u32)->vec3f{let x=f32(id);return fract(sin(vec3f(x,x*1.37,x*2.17)*vec3f(12.9898,78.233,45.164))*43758.5453);}
fn vertPos(base:u32,idx:u32)->vec3f{let i=(base+idx)*3u;return vec3f(positions[i],positions[i+1u],positions[i+2u]);}
fn vertUv(base:u32,idx:u32)->vec2f{let i=(base+idx)*2u;return vec2f(uvs[i],uvs[i+1u]);}
fn vertN(base:u32,idx:u32)->vec3f{let i=(base+idx)*7u;return vec3f(normals[i],normals[i+1u],normals[i+2u]);}
fn vertT(base:u32,idx:u32)->vec4f{let i=(base+idx)*7u+3u;return vec4f(normals[i],normals[i+1u],normals[i+2u],normals[i+3u]);}
fn edge(a:vec2f,b:vec2f,p:vec2f)->f32{return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}
fn wrapCoord(t:f32,repeat:bool)->f32{return select(clamp(t,0.0,1.0),fract(t),repeat);}
${NORMAL_TRANSFORM_WGSL}
struct SurfaceOut{@location(0) baseMetal:vec4f,@location(1) normalRough:vec4f,@location(2) emissiveAo:vec4f,@location(3) flags:u32,}
fn emptySurface()->SurfaceOut{return SurfaceOut(vec4f(0.0),vec4f(0.0),vec4f(0.0),0u);}
fn diagnosticSurface(color:vec3f)->SurfaceOut{return SurfaceOut(vec4f(color,0.0),vec4f(0.0),vec4f(0.0),3u);}
fn framebuffer(clip:vec4f)->vec3f{
 let ndc=clip.xyz/clip.w;
 return vec3f((ndc.x*0.5+0.5)*uni.viewport.x,(-ndc.y*0.5+0.5)*uni.viewport.y,ndc.z);
}
@vertex fn shade_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let x=f32(i32(i&1u)*4-1);let y=f32(i32(i>>1u)*4-1);return vec4f(x,y,0.0,1.0);
}
@fragment fn shade_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 let coord=vec2<i32>(i32(pos.x),i32(pos.y));
 let id=textureLoad(vis,coord,0).r;
 if(id==0u){return emptySurface();}
 let pageIndex=(id>>16u)-1u;let tri=id&0xffffu;
 if(pageIndex>=uni.pageCount){return emptySurface();}
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount){return emptySurface();}
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
 let absArea=abs(area);
 let width=select(vec3f(0.005),vec3f(abs(s1.y-s2.y)+abs(s2.x-s1.x),abs(s2.y-s0.y)+abs(s0.x-s2.x),abs(s0.y-s1.y)+abs(s1.x-s0.x))/absArea,absArea>0.0);
 var ddx=vec2f(0.0);var ddy=vec2f(0.0);
 if((page.flags&4u)!=0u){
  uv=vertUv(page.vertexBase,i0)*bary.x+vertUv(page.vertexBase,i1)*bary.y+vertUv(page.vertexBase,i2)*bary.z;
 }
 if((page.flags&4u)!=0u){
  let uva=vertUv(page.vertexBase,i0);let uvb=vertUv(page.vertexBase,i1);let uvc=vertUv(page.vertexBase,i2);
  let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
  if(det!=0.0){
   let inv=1.0/det;let dsdx=dyc*inv;let dsdy=-dxc*inv;let dtdx=-dyb*inv;let dtdy=dxb*inv;
   let s=((p.x-s0.x)*dyc-(p.y-s0.y)*dxc)*inv;let t=((p.y-s0.y)*dxb-(p.x-s0.x)*dyb)*inv;let a0=1.0-s-t;
   let iw0=1.0/c0.w;let iw1=1.0/c1.w;let iw2=1.0/c2.w;
   let U=a0*uva*iw0+s*uvb*iw1+t*uvc*iw2;let W=a0*iw0+s*iw1+t*iw2;
   if(W!=0.0){
    let dUds=-uva*iw0+uvb*iw1;let dUdt=-uva*iw0+uvc*iw2;let dWds=-iw0+iw1;let dWdt=-iw0+iw2;
    let dUdx=dUds*dsdx+dUdt*dtdx;let dUdy=dUds*dsdy+dUdt*dtdy;let dWdx=dWds*dsdx+dWdt*dtdx;let dWdy=dWds*dsdy+dWdt*dtdy;
    ddx=(dUdx*W-U*dWdx)/(W*W);ddy=(dUdy*W-U*dWdy)/(W*W);
   }
  }
 }
 let wrapped=vec2f(wrapCoord(uv.x,(page.flags&32u)!=0u),wrapCoord(uv.y,(page.flags&64u)!=0u))*page.uvScale;
 let sample=textureSampleGrad(maps,mapsSampler,wrapped,i32(page.mapIndex),ddx*page.uvScale,ddy*page.uvScale);
 let wrapD=vec2f(wrapCoord(uv.x,(page.flags&32u)!=0u),wrapCoord(uv.y,(page.flags&64u)!=0u));
 var roughSample=vec4f(1.0);
 if(page.roughnessIndex!=0u){roughSample=textureSampleGrad(dataMaps,mapsSampler,wrapD*page.roughUvScale,i32(page.roughnessIndex),ddx*page.roughUvScale,ddy*page.roughUvScale);}
 var metalSample=vec4f(1.0);
 if(page.metalnessIndex!=0u){metalSample=textureSampleGrad(dataMaps,mapsSampler,wrapD*page.metalUvScale,i32(page.metalnessIndex),ddx*page.metalUvScale,ddy*page.metalUvScale);}
 var ao=1.0;
 if(page.aoIndex!=0u){ao=1.0+page.aoIntensity*(textureSampleGrad(dataMaps,mapsSampler,wrapD*page.aoUvScale,i32(page.aoIndex),ddx*page.aoUvScale,ddy*page.aoUvScale).r-1.0);}
 var emissive=page.emissive.xyz;
 if(page.emissiveIndex!=0u){emissive*=textureSampleGrad(maps,mapsSampler,wrapD*page.emissiveUvScale,i32(page.emissiveIndex),ddx*page.emissiveUvScale,ddy*page.emissiveUvScale).rgb;}
 var nrmSample=vec4f(0.5,0.5,1.0,1.0);
 if(page.normalIndex!=0u){nrmSample=textureSampleGrad(dataMaps,mapsSampler,wrapD*page.normalUvScale,i32(page.normalIndex),ddx*page.normalUvScale,ddy*page.normalUvScale);}
 if((page.flags&8u)!=0u){
  rgb=rgb*sample.xyz;
  if((page.flags&128u)!=0u&&sample.w<page.baseColor.w){return emptySurface();}
 }
 if(uni.mode==1u){
  let edgeW=1.0-min(min(smoothstep(0.0,width.x*1.2,bary.x),smoothstep(0.0,width.y*1.2,bary.y)),smoothstep(0.0,width.z*1.2,bary.z));
  return diagnosticSurface(mix(hashColor(id)*0.7,vec3f(0.04,0.05,0.07),edgeW));
 }
 if(uni.mode==2u){return diagnosticSurface(hashColor(page.clusterHash));}
 if(uni.mode==3u){return diagnosticSurface(vec3f(0.204,0.827,0.6));}
 var metal=clamp(page.metalness*metalSample.z,0.0,1.0);var rough=clamp(page.roughness*roughSample.y,0.0525,1.0);
 // Original vertices may straddle the near plane; recover the clipped winding.
  let screenFace=select(-1.0,1.0,area*c0.w*c1.w*c2.w<0.0);
  let world3=mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz);
  let face=screenFace*select(-1.0,1.0,determinant(world3)>=0.0);
  let side=select(1.0,-1.0,(page.flags&256u)!=0u);
  var n0=xformNormal(page.world,vertN(page.vertexBase,i0))*side;
  var n1=xformNormal(page.world,vertN(page.vertexBase,i1))*side;
  var n2=xformNormal(page.world,vertN(page.vertexBase,i2))*side;
  var N=normalize(cross((w1-w0).xyz,(w2-w0).xyz))*screenFace;
  if((page.flags&16u)!=0u){
   N=normalize(n0*bary.x+n1*bary.y+n2*bary.z);
   if((page.flags&2u)!=0u){N*=face;}
  }
  if(page.normalIndex!=0u){
   let nrm=nrmSample.xyz*2.0-vec3f(1.0);
   let mapN=vec3f(nrm.x*page.normalScale,nrm.y*page.normalScaleY,nrm.z);
   var T=vec3f(0.0);var B=vec3f(0.0);
   if((page.flags&2048u)!=0u){
    let ta=vertT(page.vertexBase,i0);let tb=vertT(page.vertexBase,i1);let tc=vertT(page.vertexBase,i2);
    let t0=normalize(world3*ta.xyz)*side;let t1=normalize(world3*tb.xyz)*side;let t2=normalize(world3*tc.xyz)*side;
    T=normalize(t0*bary.x+t1*bary.y+t2*bary.z);
    B=normalize(normalize(cross(n0,t0)*ta.w)*bary.x+normalize(cross(n1,t1)*tb.w)*bary.y+normalize(cross(n2,t2)*tc.w)*bary.z);
   }else{
    let e1=(w1-w0).xyz;let e2=(w2-w0).xyz;
    let uva=vertUv(page.vertexBase,i0);let uvb=vertUv(page.vertexBase,i1);let uvc=vertUv(page.vertexBase,i2);
    let duv1=uvb-uva;let duv2=uvc-uva;
    T=(cross(e2,N)*duv1.x+cross(N,e1)*duv2.x)*screenFace;
    B=(cross(e2,N)*duv1.y+cross(N,e1)*duv2.y)*screenFace;
    let scale=inverseSqrt(max(max(dot(T,T),dot(B,B)),1e-20));T*=scale;B*=scale;
   }
   if((page.flags&2u)!=0u&&(page.flags&16u)!=0u){T*=face;B*=face;}
   N=normalize(T*mapN.x+B*mapN.y+N*mapN.z);
  }
 return SurfaceOut(vec4f(rgb,metal),vec4f(N,rough),vec4f(emissive,ao),select(1u,2u,(page.flags&1u)!=0u));
}
`;
