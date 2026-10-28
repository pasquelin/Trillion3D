import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LIGHT_PROFILE_COORDINATES_WGSL } from './lightProfileCoordinates.ts'

/** Where a program binds the profile atlas (a `texture_2d_array<f32>`) and its sampler. */
export interface LightProfileBindings {
  readonly group: number
  readonly atlas: number
  readonly sampler: number
}

/** The bindings as a block name reads them. */
export const lightProfileBindingsLabel = (b: LightProfileBindings) =>
  `${b.group}, ${b.atlas}, ${b.sampler}`

/**
 * The share of a light that leaves toward the point `P`: the profile of atlas slice `slice` read at
 * the point's coordinates (`lightProfileCoordinates`), bilinear and clamped; 1 for a light with no
 * slice (a negative one). `direction` is the way the light shines and `axis` its own axis.
 */
export const lightProfileMultiplierWgsl = (b: LightProfileBindings) =>
  wgslBlock(
    `lightProfileMultiplierWgsl(${lightProfileBindingsLabel(b)})`,
    [LIGHT_PROFILE_COORDINATES_WGSL],
    `@group(${b.group}) @binding(${b.atlas}) var lightProfileAtlas:texture_2d_array<f32>;
@group(${b.group}) @binding(${b.sampler}) var lightProfileSampler:sampler;
fn lightProfileMultiplier(P:vec3f,lightPosition:vec3f,direction:vec3f,axis:vec3f,slice:i32)->f32{
 if(slice<0){return 1.0;}
 let at=lightProfileCoordinates(P,lightPosition,direction,axis);
 return textureSampleLevel(lightProfileAtlas,lightProfileSampler,at,slice,0.0).r;
}`,
  )
