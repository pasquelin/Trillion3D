import { lightsIrradianceWgsl } from '../direct/lightLoopWgsl.ts'
import {
  lightFunctionBindingsLabel,
  type LightFunctionBindings,
} from '../lightFunction/readWgsl.ts'
import type { CloudShadowBindings } from '../atmosphere/cloudShadowRead.ts'
import { BOUNCE_LIGHT_CELL_WGSL } from './lightCellWgsl.ts'
import { INDIRECT_HELD_WGSL } from './indirectWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'

/** The radiance a surface of diffuse `albedo` returns from a point `P` of normal `N`, Lambert's, under
 *  the indirect light there (`indirectHeld`: what the cascades hold, nothing for what they do not):
 *  `surfaceSeen`, that alone — a reflection's hit, read —; `surfaceLit`, the lights'
 *  irradiance too — walking the lights of its cell (`bounceLightSlice`), shadows traced against the
 *  proxy —, what a probe's ray brings back to build the cascades. Every program that traces binds the
 *  light grid's buffer as `tileLights`. The lights wear their light functions where the program binds the atlas
 *  (`lightFunction`, `lightFunctionBounce`); a program without it lights plain. They wear the clouds' shade where it binds
 *  the maps (`cloudShadow`). */
export const surfaceRayWgsl = (
  lightFunction?: LightFunctionBindings,
  cloudShadow?: CloudShadowBindings,
) =>
  wgslBlock(
    `surfaceRayWgsl(${lightFunctionBindingsLabel(lightFunction)}, ${cloudShadow ? cloudShadow.block : null})`,
    [
      lambertDiffuse,
      lightsIrradianceWgsl(lightFunction, cloudShadow),
      BOUNCE_LIGHT_CELL_WGSL,
      INDIRECT_HELD_WGSL,
    ],
    `
fn surfaceSeen(albedo:vec3f,P:vec3f,N:vec3f)->vec3f{return lambertDiffuse(albedo,0.0,indirectHeld(P,N),1.0);}
fn surfaceLit(albedo:vec3f,P:vec3f,N:vec3f,reach:f32)->vec3f{
 return lambertDiffuse(albedo,0.0,lightsIrradiance(P,N,reach)+indirectHeld(P,N),1.0);
}`,
  )
