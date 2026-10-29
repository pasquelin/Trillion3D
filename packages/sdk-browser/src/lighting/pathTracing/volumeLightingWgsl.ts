import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PT_CLOUD_INTERSECT_WGSL } from './cloudWgsl.ts'
import { PT_AIR_WGSL } from './airWgsl.ts'
import { PT_HIT_KIND, PT_HIT_WGSL } from './hitRecordWgsl.ts'
import { PT_STATE_WGSL } from './pathWgsl.ts'
import { PT_VOLUME_LIGHT_WGSL } from './volumeLightWgsl.ts'

/**
 * THE LAMPS' LIGHT OF A VOLUME BY A POINT DRAWN ON THE RAY (`ptVolumeLights(path, hit, camera)`, `pathTracingVolumeMISMode` 1), once the trace of the bounce has found what the ray meets: the stretch of the ray the walk went through (from where it enters the air to
 * the surface, the planet or the air's top) is found again from the ray and the hit, the throughput the walk began with is the path's (`PtPath.segment`). Each lamp or rectangle that reaches the stretch (`ptPrepareVolumeLight`) weighs in the choice of one by the light it gives
 * along it times its share of scattering in a volume; the point is drawn with the density that lamp asks, the transmittance of the air (and, where the clouds are traced, the clouds) up to it is taken, and the light is gathered there as at a scattering event: the lamp
 * sampled and weighed against the phase function's own density (`pathTracingMISMode`), the phase function sampled toward the lamp and weighed against the lamp's, the shadow of either kept where the lamp's shadow also shadows a volume. The scattering events the walk
 * kept then light by the suns and the sky alone (the finish limits the lights of a medium event to those at infinity).
 */
export const PT_VOLUME_LIGHTING_WGSL = (clouds: boolean) =>
  wgslBlock(
    `PT_VOLUME_LIGHTING_WGSL${clouds ? '(clouds)' : ''}`,
    [
      PT_AIR_WGSL,
      PT_HIT_WGSL,
      PT_STATE_WGSL,
      PT_VOLUME_LIGHT_WGSL,
      ...(clouds ? [PT_CLOUD_INTERSECT_WGSL] : []),
    ],
    `fn ptVolumeLights(path:ptr<function,PtPath>,h:PtHit,camera:bool){
 let ro=(*path).origin;
 let rd=(*path).direction;
 let start=(*path).segment;
 if(!any(start>vec3f(0.0))){return;}
 let r=ptAirRayOf(ro,rd);
 let span=ptAirSpan(r);
 let near=span.near;
 let far=min(span.far,select(PT_T_MAX,h.distance,h.kind==${PT_HIT_KIND.surface}u));
 if(!(near<far)){return;}
 let first=ptGridParams.infinite;
 var cdf:array<f32,PT_LIGHT_TABLE>;
 var sum=0.0;
 for(var id=first;id<ptView.counts.x;id++){
  let setup=ptPrepareVolumeLight(id,ro,rd,near,far);
  if(ptVolumeValid(setup)){sum+=max(setup.importance*ptLightScattering(id),0.0);}
  cdf[id-first]=sum;
 }
 if(!(sum>0.0)){return;}
 let e=ptRand2(&(*path).rand);
 let picked=ptSelectLight(e.x*sum,ptView.counts.x-first,&cdf);
 let id=first+u32(picked.x);
 let pick=picked.y/sum;
 let setup=ptPrepareVolumeLight(id,ro,rd,near,far);
 let drawn=ptVolumeDistance(setup,e.y);
 let t=drawn.x;
 let there=ro+rd*t;
 let air=ptAirDensityAt(r,rd,t);
 var scatter=(air.rayleigh+air.mie)*0.001;
 var through=select(ptAirNullTrack(path,r,rd,near,t),ptAirTransmittance(r,near,t),ptAirAnalytic());
 ${
   clouds
     ? ` if(ptCloudOn()&&(*path).roughness<=ptCloud.march.w){
  cloudMaterialStart(ptCloud.centre.w);
  let cloud=ptCloudDensityAt(there,ptAirAt(r.h,r.c,t*0.001).x);
  scatter+=cloud.albedo*cloud.extinction;
  if(any(through>vec3f(0.0))){through*=ptCloudVisible(path,ro,rd,t,(*path).roughness,1.0);}
 }
 `
     : ''
 }var contribution=start*scatter*through/(drawn.y*pick);
 if(!any(contribution>vec3f(0.0))){return;}
 let phase=ptAirPhaseAt(there${clouds ? ',0u,(*path).roughness' : ''});
 let view=-rd;
 let draws=ptRand3(&(*path).rand);
 let intensity=ptLightScattering(id);
 let casts=ptLightCastsVolumeShadow(id);
 let misMode=ptView.seeds.z;
 if(misMode!=0u){
  let ls=ptSampleLight(id,draws.xy,there,vec3f(0.0));
  if(ls.pdf>0.0&&any(ls.radianceOverPdf>vec3f(0.0))){
   let evaluated=ptAirEvalPhase(phase,view,ls.direction);
   var light=contribution*ls.radianceOverPdf*intensity*evaluated.weight*evaluated.pdf;
   if(misMode==2u){light*=ptMisPower(ls.pdf,evaluated.pdf);}
   light*=ptVisibleRgb(path,there,ls.direction,ls.distance,casts${clouds ? ',true' : ''});
   ptAccumulate(path,light,camera);
  }
 }
 if(misMode!=1u){
  let sampled=ptAirSamplePhase(phase,view,draws);
  if(sampled.pdf>0.0){
   let met=ptTraceLight(there,sampled.direction,0.0,PT_T_MAX,id);
   if(met.hitT>0.0){
    var light=contribution*sampled.weight*met.radiance*intensity;
    if(misMode==2u){light*=ptMisPower(sampled.pdf,met.pdf);}
    light*=ptVisibleRgb(path,there,sampled.direction,met.hitT,casts${clouds ? ',true' : ''});
    ptAccumulate(path,light,camera);
   }
  }
 }
}`,
  )
