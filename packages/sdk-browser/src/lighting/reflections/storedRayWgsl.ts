import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBE_AXIS_WGSL } from '../lobeAxisWgsl.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'

/**
 * THE RAY A GRID TEXEL STORED (`reflectionStoredRay`), read by every stage after the ray generation, and the distance and cache mark of its thread.
 */
export const REFLECTION_STORED_RAY_WGSL = wgslBlock(
  'REFLECTION_STORED_RAY_WGSL',
  [REFLECTION_SAMPLE_WGSL, LOBE_AXIS_WGSL, REFLECTION_SURFACES_WGSL],
  `/** The ray of grid texel texel as the ray generation stored it, read as the storage it is written through: the lobe ray of its direction (unit again, the
 *  halves holding it to a thousandth, and read through the thin lobe lobeAlpha(0.0), the only part of the lobe a stage reads), its cone angle and
 *  whether its pixel is a first-person object's. The thread's own furthest distance and whether it reads the radiance cache (reflectionLimit,
 *  reflectionCached) are the ones the texel's distance layer holds (REFLECTION_RAY_DISTANCE, radianceCache/wgsl.ts): none for a ray the cache did not shorten. */
struct ReflectionStoredRay{ray:ReflectionLobeRay,cone:f32,firstPerson:bool,}
fn reflectionStoredRay(texel:vec2i)->ReflectionStoredRay{
 let kept=bitcast<f32>(textureLoad(surfaceRays,texel,REFLECTION_RAY_DISTANCE).r);
 reflectionLimit=abs(kept);
 reflectionCached=kept<0.0;
 let r=reflectionRayOf(textureLoad(surfaceRays,texel,REFLECTION_RAY_DIRECTION).r,textureLoad(surfaceRays,texel,REFLECTION_RAY_CONE).r);
 return ReflectionStoredRay(ReflectionLobeRay(normalize(r.xyz),vec4f(0.0,0.0,0.0,lobeAlpha(0.0)),0.0,0.0),abs(r.w),r.w<0.0);
}`,
)
