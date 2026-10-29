import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { REFLECTION_VIEW_WGSL } from './viewLayout.ts'
import { SKY_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'

/**
 * The reflected lobe (`reflectionLobeOf`): the direction `R` at its centre and `rough` the roughness the radiance around the scene is read at.
 */
export const REFLECTION_LOBE_WGSL = wgslBlock(
  'REFLECTION_LOBE_WGSL',
  [],
  `struct ReflectionLobe{R:vec3f,rough:f32,}
fn reflectionLobeOf(R:vec3f,alpha:f32)->ReflectionLobe{
 return ReflectionLobe(R,sqrt(alpha));
}`,
)

/** A radiance a ray brings back (`reflectionClampRay`) held to the ceiling of a ray, `ReflectionView.light.x`: the setting's, 40 in the
 *  display's white by default, over the image's pre-exposure, the radiance being the scene's, not yet multiplied by it: its largest
 *  component past it, the whole scaled down to it. */
export const REFLECTION_CLAMP_WGSL = wgslBlock(
  'REFLECTION_CLAMP_WGSL',
  [REFLECTION_VIEW_WGSL],
  `fn reflectionClampRay(c:vec3f)->vec3f{
 let most=max(c.x,max(c.y,c.z));
 return select(c,c*(reflectionView.light.x/most),most>reflectionView.light.x);
}`,
)

/** The radiance around the scene (`reflectionEnvironment`), one rule: a ray along `R` that leaves the scene reaches what the sky light gives it
 *  in that direction at the roughness `rough` of the lobe it stands for (`skyRadianceAt`: the sky light's filtered cube, black without a lit
 *  one): no colour of the background is added, a ray that meets no surface and no sky is black. The environment's coefficients light the
 *  diffuse term alone. */
export const REFLECTION_ENVIRONMENT_WGSL = wgslBlock(
  'REFLECTION_ENVIRONMENT_WGSL',
  [SKY_READ_WGSL],
  `fn reflectionEnvironment(R:vec3f,rough:f32)->vec3f{
 return skyRadianceAt(R,rough);
}`,
)

/** What a stage of a ray's answer brings back: the radiance of what it met, whether it met one (a hit, or a miss that goes to the
 *  next stage), and the distance to what answered — the screen's, the scene's, one struct. */
export const RADIANCE_ANSWER = wgslStruct(
  'RadianceAnswer',
  [],
  'struct RadianceAnswer{color:vec3f,hit:bool,distance:f32,}',
)
