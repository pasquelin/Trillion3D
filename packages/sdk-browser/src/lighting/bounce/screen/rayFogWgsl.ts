import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { reflectionFogWgsl } from '../../reflections/rayLightWgsl.ts'
import type { RayFogBindings } from '../../reflections/rayFog.ts'

/**
 * THE HEIGHT FOG LAID OVER THE LIGHT OF A RAY (`spRayFogged`), in the stage that writes the light, before it is quantized once: the fog the reflections lay over
 * their rays (`reflectionFogged`, which does nothing where the reflections' height fog is off or the scene's fog is not a height fog), seen from `origin` along the ray
 * `d` over `distance` metres. A ray that `hit` a surface is fogged over the distance it hit at; a ray that hit nothing, answered by the radiance cache or the sky, over
 * `distance` or `ReflectionView.light.w`, whichever is longer, so that the fog of the sky does not depend on how far the rays go. A program that lists it names the
 * lights (`directLights`) and the reflection group (`reflectionView`, `reflectionDone`, the sky light), which it binds: the fog's own reads at `b` are declared by the
 * fog module (`fogBlockOf`) the block takes in.
 */
export const rayFogWgsl = (b: RayFogBindings) =>
  wgslBlock(
    `rayFogWgsl(${b.cubemap},${b.sampler})`,
    [reflectionFogWgsl(b.cubemap, b.sampler)],
    `fn spRayFogged(light:vec3f,origin:vec3f,d:vec3f,distance:f32,hit:bool)->vec3f{
 return reflectionFogged(light,origin,d*select(max(distance,reflectionView.light.w),distance,hit));
}`,
  )
