import { FULLSCREEN_XY } from '../../gpu/shader/fullscreenTriangle.ts'
import { SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModel.ts'
import { preExposedWgsl } from '../../post/exposure/preWgsl.ts'
import { CLOUD_HAZE_WGSL } from './cloudHazeWgsl.ts'
import { PLANET_TO_SCENE } from './hazeWgsl.ts'
import { airProgram, type AirBindings } from './programs.ts'
import type { AirShape } from './shape.ts'

/**
 * THE HAZE MARCHED ON THE OPAQUE SURFACES (`aerialFastOnOpaque` off): in place of the volume the
 * surfaces read, a fullscreen pass over the lit image marches the air for each pixel a surface was
 * drawn on, from the eye to the surface's depth (`cloudHaze`: the same march, its samples jittered
 * by the blue noise of the pixel, the air's lights shaded by the shadow maps and the clouds), and
 * lays the light it scatters over the pixel, what is under it kept by the air's transmittance: the
 * pass draws premultiplied, an alpha of the transmittance. A pixel no surface was drawn on is left
 * (the sky draws it, `skyWgsl.ts`). The translucent surfaces keep reading the volume.
 */
export const opaqueHazeAir = (shape: AirShape): AirBindings => ({
  air: 'read',
  transmittance: true,
  multiScatter: true,
  frame: true,
  flags: true,
  depth: true,
  noise: true,
  shadow: shape.shadows,
  cloudShadow: true,
})

export const opaqueHazeProgram = (shape: AirShape) =>
  airProgram(
    opaqueHazeAir(shape),
    `${PLANET_TO_SCENE}
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}
@fragment fn opaqueHazeMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 if((textureLoad(flags,vec2i(pixel.xy),0).r&${SURFACE_MODEL_MASK}u)==0u||frame.eye.w==0.0){discard;}
 let depth=textureLoad(depthTex,vec2i(pixel.xy),0);
 let world=frame.inverseViewProj*vec4f(pixel.x*frame.size.z*2.0-1.0,1.0-pixel.y*frame.size.w*2.0,depth,1.0);
 let ray=world.xyz/world.w-frame.eye.xyz;
 let haze=cloudHaze(normalize(ray),length(ray)*0.001,blueNoiseScalar(vec2u(pixel.xy),frame.index.x));
 return vec4f(preExposed(haze.rgb),haze.a);
}`,
    [CLOUD_HAZE_WGSL, preExposedWgsl('frame.preExposure.x')],
    shape,
  )
