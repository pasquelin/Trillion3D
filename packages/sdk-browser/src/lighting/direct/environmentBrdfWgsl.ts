import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
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
  [],
  `
fn environmentBrdfTexel(x:i32,y:i32)->vec2f{
 let at=u32(clamp(y,0,${ENV_BRDF_HEIGHT - 1}))*${ENV_BRDF_WIDTH}u+u32(clamp(x,0,${ENV_BRDF_WIDTH - 1}));
 return unpack2x16unorm(directLights.envBrdf[at]);
}
fn environmentBrdfPair(rough:f32,NdotV:f32)->vec2f{
 let p=vec2f(NdotV,rough)*vec2f(${ENV_BRDF_WIDTH}.0,${ENV_BRDF_HEIGHT}.0)-0.5;
 let f=floor(p);
 let t=p-f;
 let x=i32(f.x);let y=i32(f.y);
 return mix(mix(environmentBrdfTexel(x,y),environmentBrdfTexel(x+1,y),t.x),mix(environmentBrdfTexel(x,y+1),environmentBrdfTexel(x+1,y+1),t.x),t.y);
}
fn environmentBrdf(f0:vec3f,f90:f32,rough:f32,NdotV:f32)->vec3f{
 let ab=environmentBrdfPair(rough,NdotV);
 return f0*ab.x+vec3f(f90*ab.y);
}`,
)
