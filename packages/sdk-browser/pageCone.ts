import {coneRejects} from '../sdk-core/index.ts';
import * as THREE from 'three';

export type NormalCone = { axis:[number,number,number]; angle:number };
/** Never rejects. */
export const OPEN_CONE: NormalCone = {axis:[0,0,1], angle: Math.PI};

const scratch={box:new THREE.Box3(),normal:new THREE.Matrix3(),axis:new THREE.Vector3(),center:new THREE.Vector3(),cam:new THREE.Vector3()};

function faceCross(positions:ArrayLike<number>,ia:number,ib:number,ic:number){
 const ax=positions[ia],ay=positions[ia+1],az=positions[ia+2];
 const e1x=positions[ib]-ax,e1y=positions[ib+1]-ay,e1z=positions[ib+2]-az;
 const e2x=positions[ic]-ax,e2y=positions[ic+1]-ay,e2z=positions[ic+2]-az;
 return [e1y*e2z-e1z*e2y,e1z*e2x-e1x*e2z,e1x*e2y-e1y*e2x] as const;
}

/** Bounding cone of triangle normals. Degenerate faces skipped; none valid → OPEN_CONE. */
export function triangleCone(positions:ArrayLike<number>,indices:ArrayLike<number>):NormalCone{
 let sx=0,sy=0,sz=0,count=0;
 for(let i=0;i+2<indices.length;i+=3){
  const c=faceCross(positions,indices[i]*3,indices[i+1]*3,indices[i+2]*3);
  const len=Math.hypot(c[0],c[1],c[2]);
  if(!(len>0))continue;
  sx+=c[0];sy+=c[1];sz+=c[2];
  count++;
 }
 if(!count)return OPEN_CONE;
 const sl=Math.hypot(sx,sy,sz);
 if(!(sl>0))return OPEN_CONE;
 const axis:[number,number,number]=[sx/sl,sy/sl,sz/sl];
 let angle=0;
 for(let i=0;i+2<indices.length;i+=3){
  const c=faceCross(positions,indices[i]*3,indices[i+1]*3,indices[i+2]*3);
  const len=Math.hypot(c[0],c[1],c[2]);
  if(!(len>0))continue;
  const d=Math.min(1,Math.max(-1,(c[0]*axis[0]+c[1]*axis[1]+c[2]*axis[2])/len));
  const a=Math.acos(d);
  if(a>angle)angle=a;
 }
 return {axis,angle};
}

export function mergeCones(left:NormalCone,right:NormalCone):NormalCone{
 if(left.angle>=Math.PI||right.angle>=Math.PI)return OPEN_CONE;
 const ax=left.axis[0]+right.axis[0],ay=left.axis[1]+right.axis[1],az=left.axis[2]+right.axis[2];
 const len=Math.hypot(ax,ay,az);
 if(!(len>1e-12))return OPEN_CONE;
 const axis:[number,number,number]=[ax/len,ay/len,az/len];
 const child=(c:NormalCone)=>{
  const d=Math.min(1,Math.max(-1,c.axis[0]*axis[0]+c.axis[1]*axis[1]+c.axis[2]*axis[2]));
  return Math.acos(d)+c.angle;
 };
 return {axis,angle:Math.min(Math.PI,Math.max(child(left),child(right)))};
}

export function perspectiveSpread(center:[number,number,number],radius:number,cameraWorld:[number,number,number]):number{
 const d=Math.hypot(cameraWorld[0]-center[0],cameraWorld[1]-center[1],cameraWorld[2]-center[2]);
 if(!(d>radius))return Math.PI;
 const t=radius/d;
 return Math.asin(t<0?0:t>1?1:t);
}

export function coneCullsPage(cone:NormalCone,world:THREE.Matrix4,min:number[],max:number[],camera:THREE.PerspectiveCamera):boolean{
 if(cone.angle>=Math.PI/2)return false;
 const {box,normal,axis,center,cam}=scratch;
 box.min.fromArray(min);box.max.fromArray(max);box.applyMatrix4(world);
 center.addVectors(box.min,box.max).multiplyScalar(0.5);
 const radius=Math.hypot((box.max.x-box.min.x)*0.5,(box.max.y-box.min.y)*0.5,(box.max.z-box.min.z)*0.5);
 camera.updateMatrixWorld();
 camera.getWorldPosition(cam);
 const spread=perspectiveSpread([center.x,center.y,center.z],radius,[cam.x,cam.y,cam.z]);
 axis.fromArray(cone.axis).applyMatrix3(normal.getNormalMatrix(world));
 const al=axis.length();
 if(!(al>0))return false;
 axis.multiplyScalar(1/al);
 const vx=cam.x-center.x,vy=cam.y-center.y,vz=cam.z-center.z;
 const vl=Math.hypot(vx,vy,vz);
 if(!(vl>0))return false;
 const dot=Math.min(1,Math.max(-1,(axis.x*vx+axis.y*vy+axis.z*vz)/vl));
 try{return coneRejects(dot,cone.angle,spread);}catch{return false;}
}
