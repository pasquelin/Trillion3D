import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { REFLECTION_VIEW_WGSL } from './viewLayout.ts'
import { SQRT2 } from '../../../../math/src/wgsl/constants.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { SKY_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'

/**
 * The cone and the fade, pure functions of their arguments.
 *
 * `reflectionConeTangent`: tan of the half-angle of the reflected GGX lobe of width `alpha`
 * (rough², or a stretched lobe's α along its direction), twice the half-vector's angle at half the
 * distribution's peak — D(θ)/D(0) = ½ gives tan²θ = α²(√2 − 1)/(1 − √2 α²) —, the half-vector's
 * angle bounded at 40°: the half-maximum angle of a lobe past α² = 1/√2 does not exist, and a
 * half-vector at 45° reflects 90° off the centre, a tangent without bound; 40° keeps it finite
 * (tan 80°). Zero on a mirror.
 * `reflectionEdgeFade`: 1 inside the image of `size`, falling smoothly to 0 at its edge over
 * `REFLECTION_EDGE` of its height.
 */
export const REFLECTION_CONE_WGSL = wgslBlock(
  'REFLECTION_CONE_WGSL',
  [REFLECTION_CONSTANTS_WGSL, SQRT2],
  `fn reflectionConeTangent(alpha:f32)->f32{
 let a2=alpha*alpha;
 let h=min(sqrt(a2*(SQRT2-1.0)/max(1.0-SQRT2*a2,1e-4)),REFLECTION_CONE_LIMIT);
 return 2.0*h/(1.0-h*h);
}
fn reflectionEdgeFade(pixel:vec2f,size:vec2f)->f32{
 let s=smoothstep(vec2f(0.0),vec2f(1.0),min(pixel,size-pixel)/(REFLECTION_EDGE*size.y));
 return s.x*s.y;
}`,
)

/**
 * The reflected lobe (`reflectionLobeOf`): the direction `R` at its centre, `tangent` the tangent of the cone's half-angle at the width
 * `alpha` (`reflectionConeTangent`), the one a ray's cone widens by, and `rough` the roughness the radiance around the scene is read at.
 */
export const REFLECTION_LOBE_WGSL = wgslBlock(
  'REFLECTION_LOBE_WGSL',
  [REFLECTION_CONE_WGSL],
  `struct ReflectionLobe{R:vec3f,tangent:f32,rough:f32,}
fn reflectionLobeOf(R:vec3f,alpha:f32)->ReflectionLobe{
 return ReflectionLobe(R,reflectionConeTangent(alpha),sqrt(alpha));
}`,
)

/** A radiance a ray brings back (`reflectionClampRay`) held to the ceiling of a ray, `ReflectionView.light.x` (40 in the display's
 *  white by default): its largest component past it, the whole scaled down to it. */
export const REFLECTION_CLAMP_WGSL = wgslBlock(
  'REFLECTION_CLAMP_WGSL',
  [REFLECTION_VIEW_WGSL],
  `fn reflectionClampRay(c:vec3f)->vec3f{
 let most=max(c.x,max(c.y,c.z));
 return select(c,c*(reflectionView.light.x/most),most>reflectionView.light.x);
}`,
)

/** The radiance around the scene (`reflectionEnvironment`), one rule: a ray along `R` that leaves
 *  the scene reaches what the scene's sky gives it in that direction at the roughness `rough` of the
 *  lobe it stands for, 0 for a ray (`skyRadianceAt`: the sky light's filtered cube, none without
 *  one), where the scene shows one; else what the
 *  screen draws in its direction, the background — the declared colour or the default one, drawn
 *  behind every image (the canvas is opaque) —, as the radiance the view's exposure and curve turn
 *  into it: the uniform radiance of the view's `surroundings`, which every lobe keeps whole. The
 *  environment's coefficients light the diffuse term alone. */
export const REFLECTION_ENVIRONMENT_WGSL = wgslBlock(
  'REFLECTION_ENVIRONMENT_WGSL',
  [REFLECTION_VIEW_WGSL, SKY_READ_WGSL],
  `fn reflectionEnvironment(R:vec3f,rough:f32)->vec3f{
 if(skyShown()){return skyRadianceAt(R,rough);}
 return reflectionView.surroundings.rgb;
}`,
)

/** What a stage of a ray's answer brings back: the radiance of what it met, the confidence of the
 *  answer, and the distance to what answered — the screen's, the scene's, one struct. */
export const RADIANCE_ANSWER = wgslStruct(
  'RadianceAnswer',
  [],
  'struct RadianceAnswer{color:vec3f,confidence:f32,distance:f32,}',
)
