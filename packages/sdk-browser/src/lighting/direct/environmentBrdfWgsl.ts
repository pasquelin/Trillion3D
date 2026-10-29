import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { packedTableWgsl } from './packedTableWgsl.ts'
import {
  ENV_BRDF_HEIGHT,
  ENV_BRDF_WIDTH,
} from '../../../../sdk-core/src/lighting/environmentBrdf.ts'

/**
 * WHAT A SURFACE KEEPS OF THE LIGHT OF EVERY DIRECTION, read from the preintegrated table the light buffer holds
 * (`environmentBrdf.ts`): the table read at (N·V, roughness) as a texture is, bilinear between the texel centres and held to
 * the edge (`environmentBrdfPair`: `x` the share under a Fresnel of one, `y` the share under its fifth power). `environmentBrdf`
 * weighs it on the reflectance `f0` and its grazing value `f90`, which the caller gives (the water's: the green channel's, `envBrdfF90`), and the weight is
 * `f0·x + f90·y`. The weight of the single-layer water's reflection alone: the environment lights weigh a reflection by the energy
 * terms (`energyTermsWgsl.ts`). */
export const ENVIRONMENT_BRDF_WGSL = wgslBlock(
  'ENVIRONMENT_BRDF_WGSL',
  [
    packedTableWgsl(
      'environmentBrdfTexel',
      'environmentBrdfPair',
      'envBrdf',
      ENV_BRDF_WIDTH,
      ENV_BRDF_HEIGHT,
    ),
  ],
  `
fn environmentBrdf(f0:vec3f,f90:f32,rough:f32,NdotV:f32)->vec3f{
 let ab=environmentBrdfPair(rough,NdotV);
 return f0*ab.x+vec3f(f90*ab.y);
}`,
)
