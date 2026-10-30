import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { PT_AIR_WGSL } from './airWgsl.ts'
import { PT_CLOUD_FLAG, PT_CLOUD_POINT_WGSL } from './cloudMediumWgsl.ts'
import { PT_RADIANCE_WGSL } from './radianceWgsl.ts'
import { PT_ROUND_WGSL } from './viewWgsl.ts'

/**
 * THE CLOUDS A RAY CROSSES (`ptCloudIntersect(r, origin, direction, tMin, tMax, roughness)`, with the air's ray `r`: `ptAirRayOf`): the stretch of the ray inside the layer's shell, cut by the clip box
 * round the eye and tightened by the acceleration map — the columns it passes through, walked cell by cell, each cutting the stretch to the heights its column holds a cloud at — as `(from, to, densest extinction)`;
 * `from` at or past `to` where there is none, and none at all for a path rougher than the cutoff (`PtCloud.march.w`). The bottom of the shell cuts the front stretch only: a ray that comes out of the shell's hollow past
 * the bottom is not followed through the hollow.
 *
 * `ptCloudVisible(path, origin, direction, tMax, roughness, factor)` is what the clouds let through toward a light along a shadow ray, estimated by null tracking with the densest extinction as the majorant,
 * the extinction scaled by `factor` (1, or the share the octave of multiple scattering the ray starts from keeps).
 */
export const PT_CLOUD_INTERSECT_WGSL = wgslBlock(
  'PT_CLOUD_INTERSECT_WGSL',
  [PT_AIR_WGSL, PT_CLOUD_POINT_WGSL],
  `fn ptCloudOn()->bool{return (ptCloud.options.y&${PT_CLOUD_FLAG.on}u)!=0u;}
fn ptCloudReach()->f32{return ptCloud.layer.z*1000.0;}
fn ptCloudVoxel(p:vec2f)->vec2i{
 let side=i32(ptCloud.options.x);
 return clamp(vec2i((p+ptCloudReach())*ptCloud.march.z),vec2i(0),vec2i(side-1));
}
fn ptCloudVoxelAt(cell:vec2i)->vec2f{return vec2f(cell)*ptCloud.march.y-ptCloudReach();}
fn ptCloudInverse(d:vec3f)->vec3f{return select(vec3f(-1.0),vec3f(1.0),d>=vec3f(0.0))/max(abs(d),vec3f(1e-6));}
fn ptCloudIntersect(r:PtAirRay,origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,roughness:f32)->vec3f{
 let none=vec3f(0.0);
 if(roughness>ptCloud.march.w){return none;}
 let top=ptAirChord(r,ptCloud.layer.y)*1000.0;
 let bottom=ptAirChord(r,ptCloud.layer.x)*1000.0;
 var lo=max(top.x,tMin);
 var hi=min(top.y,tMax);
 if(!(lo<hi)){return none;}
 if(bottom.x>0.0){hi=min(bottom.x,hi);}else{lo=max(lo,bottom.y);}
 let ro=ptCloudClip(origin);
 let rd=ptCloudClip(direction);
 let inv=ptCloudInverse(rd);
 let slab0=(-ro.xy-ptCloudReach())*inv.xy;
 let slab1=(-ro.xy+ptCloudReach())*inv.xy;
 lo=max(lo,max(min(slab0.x,slab1.x),min(slab0.y,slab1.y)));
 hi=min(hi,min(max(slab0.x,slab1.x),max(slab0.y,slab1.y)));
 if(!(lo<hi)){return none;}
 hi=min(hi,lo+ptCloud.march.x);
 let side=i32(ptCloud.options.x);
 let forward=rd.xy>=vec2f(0.0);
 let p=ro.xy+lo*rd.xy;
 var cell=ptCloudVoxel(p);
 var next=vec2f(lo)+(ptCloudVoxelAt(cell+select(vec2i(0),vec2i(1),forward))-p)*inv.xy;
 let delta=abs(ptCloud.march.y*inv.xy);
 let stride=select(vec2i(-1),vec2i(1),forward);
 let stop=select(vec2i(-1),vec2i(side),forward);
 var found=vec2f(hi,lo);
 var densest=0.0;
 var cursor=lo;
 for(var i=0;i<4*side;i++){
  let data=textureLoad(ptCloudMap,cell,0);
  if(data.x>0.0){
   let z0=(data.z*1000.0-ro.z)*inv.z;
   let z1=(data.w*1000.0-ro.z)*inv.z;
   let inMin=max(cursor,min(z0,z1));
   let inMax=min(min(hi,min(next.x,next.y)),max(z0,z1));
   if(inMin<inMax){
    found=vec2f(min(found.x,inMin),max(found.y,inMax));
    densest=max(densest,data.x);
   }
  }
  if(next.x<next.y){
   cell.x+=stride.x;
   if(cell.x==stop.x||hi<next.x){break;}
   cursor=next.x;
   next.x+=delta.x;
  }else{
   cell.y+=stride.y;
   if(cell.y==stop.y||hi<next.y){break;}
   cursor=next.y;
   next.y+=delta.y;
  }
 }
 return vec3f(found,densest);
}
fn ptCloudVisible(path:ptr<function,PtPath>,origin:vec3f,direction:vec3f,tMax:f32,roughness:f32,factor:f32)->vec3f{
 if(!ptCloudOn()||!(factor>0.0)){return vec3f(1.0);}
 let r=ptAirRayOf(origin,direction);
 let c=ptCloudIntersect(r,origin,direction,0.0,tMax,roughness);
 let bar=c.z*factor;
 if(!(c.x<c.y)||!(bar>0.0)){return vec3f(1.0);}
 cloudMaterialStart(ptCloud.centre.w);
 var thr=vec3f(1.0);
 var t=c.x;
 for(var iter=0u;iter<ptAtmo.options.y;iter++){
  t-=log(1.0-ptRand1(&(*path).rand))/bar;
  if(t>=c.y){break;}
  let sigmaT=min(factor*ptCloudDensityAt(origin+direction*t,ptAirAt(r.h,r.c,t*0.001).x).extinction.x,bar);
  thr*=1.0-sigmaT/bar;
  thr*=ptAirLowClamp(thr);
  if(!any(thr>vec3f(0.0))){break;}
 }
 return thr;
}`,
)

/**
 * THE MARCH THROUGH THE CLOUDS AND THE AIR AMONG THEM (`ptCloudMarch`, the stretch `tMin` to `tMax` of `ptCloudIntersect`): the map's columns walked cell by cell, a cell holding a cloud only between the heights its column
 * found (empty above and below, so at most three stretches a cell). On each stretch the majorant is the column's densest extinction plus the air's bound over what is left of the ray, a distance is drawn in proportion to
 * the transmittance by the channel the throughput weighs, and a real collision is a place where the cloud and the air are read together: the camera's alpha grows by the light the collision takes out, the cloud's emission is
 * added by the throughput, and, when the bounce is not the last, the collision stands for the scattering event of the bounce, among the others and the surface, with the probability its contribution gives
 * (`ptPathRisAccept`) — the same collision again for each octave of the material's approximation of multiple scattering (its cloud scattering scaled by the octave's share, squared at each octave; the octave is kept
 * in `PtPath.octave`, 0 for the event as the medium holds it).
 *
 * `ptVolumeTrack` is what the trace calls where the air is: the ray's stretch cut at the cloud stretch, the air before and after it walked as the air alone (`ptAirTrack`), the clouds between (`ptCloudMarch`); with no
 * clouds in the way, the air alone.
 */
export const PT_CLOUD_MARCH_WGSL = wgslBlock(
  'PT_CLOUD_MARCH_WGSL',
  [PT_CLOUD_INTERSECT_WGSL, PT_RADIANCE_WGSL, PT_ROUND_WGSL, luminance],
  `fn ptCloudMax3(v:vec3f)->f32{return max(v.x,max(v.y,v.z));}
fn ptCloudMarch(path:ptr<function,PtPath>,r:PtAirRay,origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,camera:bool,last:bool){
 cloudMaterialStart(ptCloud.centre.w);
 let ro=ptCloudClip(origin);
 let rd=ptCloudClip(direction);
 let inv=ptCloudInverse(rd);
 let side=i32(ptCloud.options.x);
 let forward=rd.xy>=vec2f(0.0);
 var t=tMin;
 let p=ro.xy+t*rd.xy;
 var cell=ptCloudVoxel(p);
 var next=vec2f(t)+(ptCloudVoxelAt(cell+select(vec2i(0),vec2i(1),forward))-p)*inv.xy;
 let delta=abs(ptCloud.march.y*inv.xy);
 let stride=select(vec2i(-1),vec2i(1),forward);
 let stop=select(vec2i(-1),vec2i(side),forward);
 let approximate=!last&&(ptCloud.options.y&${PT_CLOUD_FLAG.approximate}u)!=0u;
 let octaves=min(u32(cloudMaterial.multiScatter.w),3u);
 var thr=(*path).throughput;
 for(var iter=0u;iter<ptAtmo.options.y;iter++){
  let data=textureLoad(ptCloudMap,cell,0);
  var density=data.x;
  let cellEnd=min(tMax,min(next.x,next.y));
  var stretchEnd=cellEnd;
  if(density>0.0){
   let z0=(data.z*1000.0-ro.z)*inv.z;
   let z1=(data.w*1000.0-ro.z)*inv.z;
   let inMin=max(t,min(z0,z1));
   let inMax=min(cellEnd,max(z0,z1));
   if(inMin<inMax){
    if(t<inMin){
     density=0.0;
     stretchEnd=inMin;
    }else if(t<inMax){
     stretchEnd=inMax;
    }else{
     density=0.0;
    }
   }else{
    density=0.0;
   }
  }
  let bar=vec3f(density)+ptAirBound(r,t,tMax);
  let dist=ptAirSampleDistance(ptRand1(&(*path).rand),bar,thr);
  if(dist<0.0){break;}
  if(t+dist<stretchEnd){
   thr*=ptAirHit(dist,bar,thr);
   t+=dist;
   let there=origin+direction*t;
   let cloud=ptCloudDensityAt(there,ptAirAt(r.h,r.c,t*0.001).x);
   let air=ptAirDensityAt(r,direction,t);
   let sigmaT=min(cloud.extinction+air.extinction*0.001,bar);
   if(camera){(*path).alpha+=luminance(thr*sigmaT);}
   if(!last){
    let cloudScatter=cloud.albedo*cloud.extinction;
    let sigmaS=min((air.rayleigh+air.mie)*0.001+cloudScatter,sigmaT);
    let weight=1.0-saturate(((*path).roughness-0.10)/(0.15-0.10));
    (*path).albedo+=sigmaS*thr*weight;
    var contribution=thr*sigmaS;
    var chosen=ptCloudMax3(contribution);
    if(ptPathRisAccept(path,chosen)){
     (*path).eventPosition=there;
     (*path).eventThroughput=contribution/chosen;
     (*path).octave=0u;
    }
    if(approximate){
     var scatter=cloudScatter;
     var share=saturate(cloudMaterial.multiScatter.x);
     for(var k=1u;k<=octaves;k++){
      scatter*=share;
      contribution=thr*scatter;
      chosen=ptCloudMax3(contribution);
      if(ptPathRisAccept(path,chosen)){
       (*path).eventPosition=there;
       (*path).eventThroughput=contribution/chosen;
       (*path).octave=k;
      }
      share*=share;
     }
    }
   }
   if(any(cloud.emission>vec3f(0.0))){ptAccumulate(path,cloud.emission*thr,camera);}
   thr*=bar-sigmaT;
   thr*=ptAirLowClamp(thr);
   if(!any(thr>vec3f(0.0))){break;}
  }else{
   thr*=ptAirMiss(stretchEnd-t,bar,thr);
   t=stretchEnd;
  }
  if(t==cellEnd){
   if(next.x<next.y){
    cell.x+=stride.x;
    if(cell.x==stop.x||tMax<next.x){break;}
    t=next.x;
    next.x+=delta.x;
   }else{
    cell.y+=stride.y;
    if(cell.y==stop.y||tMax<next.y){break;}
    t=next.y;
    next.y+=delta.y;
   }
  }
 }
 (*path).throughput=thr;
}
fn ptVolumeTrack(path:ptr<function,PtPath>,r:PtAirRay,origin:vec3f,direction:vec3f,near:f32,far:f32,camera:bool,last:bool){
 // A new bounce opens a new reservoir: its event is the medium's as it stands until a cloud octave wins.
 if(ptRound()==0u){(*path).octave=0u;}
 var c=vec3f(0.0);
 if(ptCloudOn()){c=ptCloudIntersect(r,origin,direction,near,far,(*path).roughness);}
 // An event the air chooses is the medium's as it stands, whatever octave the clouds chose before it.
 var before=(*path).eventPosition;
 if(!(c.x<c.y)){
  ptAirTrack(path,r,origin,direction,near,far,camera,last);
  if(any((*path).eventPosition!=before)){(*path).octave=0u;}
  return;
 }
 ptAirTrack(path,r,origin,direction,near,c.x,camera,last);
 if(any((*path).eventPosition!=before)){(*path).octave=0u;}
 ptCloudMarch(path,r,origin,direction,c.x,c.y,camera,last);
 before=(*path).eventPosition;
 ptAirTrack(path,r,origin,direction,c.y,far,camera,last);
 if(any((*path).eventPosition!=before)){(*path).octave=0u;}
}`,
)
