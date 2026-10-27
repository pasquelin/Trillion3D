import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { CONE_BASE_COSINE } from '../../../../sdk-core/src/scene/light/drawRange.ts'

/**
 * THE SPHERE THAT HOLDS A CONE (`coneSphere`), the one rule of every reader of a spot's reach that bounds it on the GPU: the
 * surface cache's tiles. Under 45 degrees' cosine (`CONE_BASE_COSINE`) the sphere through the
 * cone's base circle, centred `range * cosine` along the axis, of radius `range * sine`; else the one through the apex and the base
 * rim, of radius `range / (2 * cosine)` and centred that far. `coneSphereAlong` and `coneSphereRadius`
 * (`sdk-core/src/scene/light/drawRange.ts`) are its CPU twin, which the draw range measures a spot by (`lightDrawn`). Its centre and
 * radius come as one `vec4f`, in the unit of `apex` and `range`.
 */
export const CONE_SPHERE_WGSL = wgslBlock(
  'CONE_SPHERE_WGSL',
  [],
  `const CONE_BASE_COSINE:f32=${wgslF32(CONE_BASE_COSINE)};
fn coneSphere(apex:vec3f,axis:vec3f,range:f32,cosine:f32)->vec4f{
 if(cosine<CONE_BASE_COSINE){return vec4f(apex+axis*(range*cosine),range*sqrt(1.0-cosine*cosine));}
 let radius=range/(2.0*cosine);
 return vec4f(apex+axis*radius,radius);
}`,
)
