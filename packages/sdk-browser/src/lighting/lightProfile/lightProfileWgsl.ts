import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI, TWO_PI } from '../../../../math/src/wgsl/constants.ts'
import {
  LIGHT_PROFILE_BITS,
  LIGHT_PROFILE_SHIFT,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { vectorRejection } from '../../../../math/src/wgsl/geometry.ts'
import { kindWord, lightTraits } from '../direct/lightReachWgsl.ts'

/**
 * Where a point falls in a light's profile, as the profile texture is laid out (a row for each
 * horizontal angle, a column for each vertical one, `light_profile/grid.rs`): `x` the vertical
 * angle and `y` the horizontal angle, each from 0 to 1.
 *
 * The light's frame is `direction`, the way it shines, its `tangent`, the light's own unit axis (the one a
 * tube lies along, `emitterAxis`) made perpendicular to the direction (`vectorRejection`), and their cross product `bitangent`.
 * Neither is made a unit vector: both are the sine of the angle between the axis and the direction long, and the horizontal angle,
 * the angle of a pair of dot products, does not move with that length. An axis parallel to the direction leaves no frame (the reference's
 * is the light's own orthonormal one, never degenerate): the pair is nothing and the horizontal angle is taken as 0, as on the axis. `toLight` is the unit direction from the point to the
 * light. The vertical coordinate is the angle of `toLight` to the plane perpendicular to the
 * direction, `asin(dot(toLight, direction)) / π + 0.5`: 0 straight ahead of the light, 1 straight
 * behind it. The horizontal one is the angle round the direction, in the frame's plane,
 * `atan2(-toLight.tangent, -toLight.bitangent) / 2π + 0.5`, counted from the bitangent's
 * negative side. On the axis (`toLight` along the direction) the horizontal angle is not defined;
 * it is taken as 0, the middle of the row, where every row of a well-formed profile holds the same value. The dot product is
 * held to [-1, 1]: the rounding of a unit vector must not make the arcsine a non-number.
 */
const COORDINATES_TEXT = `fn lightProfileCoordinates(P:vec3f,lightPosition:vec3f,direction:vec3f,axis:vec3f)->vec2f{
 let tangent=vectorRejection(axis,direction);
 let bitangent=cross(tangent,direction);
 let toLight=normalize(lightPosition-P);
 let along=clamp(dot(toLight,direction),-1.0,1.0);
 let sideways=vec2f(dot(toLight,bitangent),dot(toLight,tangent));
 let none=!(dot(tangent,tangent)>1e-12)||(sideways.x==0.0&&sideways.y==0.0);
 let angle=select(atan2(-sideways.y,-sideways.x),0.0,none);
 return vec2f(asin(along)/PI+0.5,angle/TWO_PI+0.5);
}`

/** The coordinates a point is read at in a light's profile (`COORDINATES_TEXT`). */
export const LIGHT_PROFILE_COORDINATES_WGSL = wgslBlock(
  'LIGHT_PROFILE_COORDINATES_WGSL',
  [PI, TWO_PI, vectorRejection],
  COORDINATES_TEXT,
)

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

/**
 * The profile factor of a light at a point: its profile lane (`LIGHT_PROFILE_SHIFT`, `LIGHT_PROFILE_BITS` bits of the kind word
 * (`kindWord`): the atlas slice plus one, 0 for none) read, the light's place, its direction and its unit axis (`emitterAxisOf`, which a
 * profiled light always carries) handed to `lightProfileMultiplier`. The lane tested first, a
 * light with no profile costs the one compare.
 */
export const lightProfileOfWgsl = (b: LightProfileBindings) =>
  wgslBlock(
    `lightProfileOfWgsl(${lightProfileBindingsLabel(b)})`,
    [lightProfileMultiplierWgsl(b), kindWord, lightTraits],
    `fn lightProfileOf(light:DirectLight,P:vec3f)->f32{
 let lane=(kindWord(light)>>${LIGHT_PROFILE_SHIFT}u)&${2 ** LIGHT_PROFILE_BITS - 1}u;
 if(lane==0u){return 1.0;}
 return lightProfileMultiplier(P,light.positionRange.xyz,light.directionCone.xyz,emitterAxisOf(light),i32(lane)-1);
}`,
  )

/** What a program that reads no profile answers: 1, a light unchanged. */
export const NO_LIGHT_PROFILE_WGSL = wgslBlock(
  'NO_LIGHT_PROFILE_WGSL',
  [],
  'fn lightProfileOf(light:DirectLight,P:vec3f)->f32{return 1.0;}',
)
