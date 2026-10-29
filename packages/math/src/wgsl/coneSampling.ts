import { wgslFn } from './decl.ts'
import { PI } from './constants.ts'
import { frameAround, outOfFrame } from './basis.ts'
import { uniformDiskConcentric } from './sampling.ts'

/**
 * DIRECTIONS IN A CONE, drawn evenly in its solid angle (`sin2` is the square of the sine of its half angle):
 * - `coneSolidAngle(sin2)` is the solid angle; the `1 - cos` of a narrow cone is a series, not the difference of two numbers that cancel;
 * - `sampleConeLocal(e, sin2, concentric)` is a direction in the frame whose third axis is the cone's (`xyz`) with its density (`w`), by the cone's angles or, when `concentric`, by a concentric map of the unit disk lifted to the cone by the equal-area cylinder map (the height `1 - cos` grows with the disk's squared radius, so the density stays even in the solid angle);
 * - `sampleCone(e, sin2, axis, concentric)` is the same direction taken to the world about `axis`.
 */
export const coneSolidAngle = wgslFn(
  'coneSolidAngle',
  [PI],
  `fn coneSolidAngle(sin2:f32)->f32{
 return 2.0*PI*select(1.0-sqrt(1.0-sin2),sin2*(0.5+0.125*sin2),sin2<0.01);
}`,
)

export const sampleConeLocal = wgslFn(
  'sampleConeLocal',
  [PI, uniformDiskConcentric],
  `fn sampleConeLocal(e:vec2f,sin2:f32,concentric:bool)->vec4f{
 let oneMinusCos=select(1.0-sqrt(1.0-sin2),sin2*(0.5+0.125*sin2),sin2<0.01);
 var local:vec3f;
 if(concentric){
  let disk=uniformDiskConcentric(e);
  let t=oneMinusCos*dot(disk,disk);
  local=vec3f(disk*sqrt(oneMinusCos*(2.0-t)),1.0-t);
 }else{
  let phi=2.0*PI*e.x;
  let cosTheta=1.0-oneMinusCos*e.y;
  let sinTheta=sqrt(max(1.0-cosTheta*cosTheta,0.0));
  local=vec3f(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
 }
 return vec4f(local,1.0/(2.0*PI*oneMinusCos));
}`,
)

export const sampleCone = wgslFn(
  'sampleCone',
  [sampleConeLocal, frameAround, outOfFrame],
  `fn sampleCone(e:vec2f,sin2:f32,axis:vec3f,concentric:bool)->vec4f{
 let local=sampleConeLocal(e,sin2,concentric);
 return vec4f(outOfFrame(local.xyz,frameAround(axis)),local.w);
}`,
)
