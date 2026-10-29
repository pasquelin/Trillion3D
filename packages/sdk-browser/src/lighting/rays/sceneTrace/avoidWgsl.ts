import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { SELF_INTERSECTION } from '../../surfaceCache/lighting/layout.ts'
import { sceneTraceWgsl } from './sceneTraceWgsl.ts'

/**
 * A RAY CAST THROUGH THE SCENE'S TRIANGLES THAT AVOIDS THE GEOMETRY IT STARTS ON (`stTraceAvoiding`), the one text the radiosity's rays, the screen probes'
 * and the translucency volume's share: the ray from `origin` along `d`, from `tMin` to `tMax`, passes the translucent primitives and, as `avoid` says
 * (`surfaceCacheHardwareRayTracingAvoidSelfIntersections`, `SELF_INTERSECTION`), has the back faces of the primitives that are not two-sided culled; or is
 * traced again from past a first hit that is a back face nearer than the trace's `skipBackFaceDistance` or a two-sided hit nearer than its
 * `skipTwoSidedDistance` (a hair past the latter, 0.01 centimetres), once; or passes such hits as it travels.
 */
export const sceneTraceAvoidWgsl = (group: number, first: number) =>
  wgslBlock(
    `SCENE_TRACE_AVOID_WGSL(${group},${first})`,
    [sceneTraceWgsl(group, first)],
    `${wgslConsts({
      ST_AVOID_CULL: SELF_INTERSECTION.cull,
      ST_AVOID_RETRACE: SELF_INTERSECTION.retrace,
      ST_AVOID_SKIP: SELF_INTERSECTION.skip,
    })}
fn stTraceAvoiding(origin:vec3f,d:vec3f,near:f32,far:f32,avoid:u32)->StHit{
 var flags=ST_SKIP_TRANSLUCENT;
 if(avoid==ST_AVOID_CULL){flags|=ST_CULL_BACK;}
 if(avoid>=ST_AVOID_SKIP){flags|=ST_SKIP_NEAR;}
 var tMin=near;
 var hit:StHit;
 for(var trace=0u;trace<2u;trace++){
  hit=stTrace(StRay(origin,d,tMin,far,flags));
  if(avoid!=ST_AVOID_RETRACE||!hit.hit||trace==1u){break;}
  var past=-1.0;
  if(hit.twoSided){
   if(hit.distance<stParams.skipTwoSidedDistance){past=hit.distance+0.01/${DISTANCE_FIELD_UNITS_PER_METRE}.0;}
  }else if(!hit.frontFace&&hit.distance<stParams.skipBackFaceDistance){past=stParams.skipBackFaceDistance;}
  if(past<=0.0){break;}
  tMin=past;
 }
 return hit;
}`,
  )
