import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModelWord.ts'
import { preExposedWgsl } from '../../post/exposure/preWgsl.ts'
import { AIR_RAY_WGSL } from './airRayWgsl.ts'
import { CLOUD_HAZE_WGSL } from './cloudHazeWgsl.ts'
import { AIR_TO_SCENE } from './hazeWgsl.ts'
import { airProgram, type AirBindings } from './programs.ts'
import type { AirShape } from './shape.ts'

/**
 * THE HAZE MARCHED ON THE OPAQUE SURFACES (`aerialFastOnOpaque` off): in place of the volume the
 * surfaces read, a fullscreen pass over the lit image marches the air for each pixel a surface was
 * drawn on, from the eye (an orthographic view's pixel: its own point, `airRay`) to the surface's depth (`cloudHaze`: the same march, its samples jittered
 * by the blue noise of the pixel, the air's lights shaded by the shadow maps and the clouds), and
 * lays the light it scatters over the pixel, what is under it kept by the air's transmittance: the
 * pass draws premultiplied, an alpha of the transmittance. A pixel no surface was drawn on is left
 * (the sky draws it, `skyWgsl.ts`). The translucent surfaces keep reading the volume.
 */
const opaqueHazeAir = (shape: AirShape): AirBindings => ({
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
    `${AIR_TO_SCENE}
@fragment fn opaqueHazeMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 if((textureLoad(flags,vec2i(pixel.xy),0).r&${SURFACE_MODEL_MASK}u)==0u){discard;}
 let depth=textureLoad(depthTex,vec2i(pixel.xy),0);
 let ndc=vec2f(pixel.x*frame.size.z*2.0-1.0,1.0-pixel.y*frame.size.w*2.0);
 let begin=airStart(ndc);
 let reach=airUnproject(ndc,depth)-begin;
 let ray=airRayOf(begin,normalize(reach));
 let haze=cloudHaze(ray.origin,ray.dir,length(reach)*0.001,blueNoiseScalar(vec2u(pixel.xy),frame.index.x));
 return vec4f(preExposed(haze.rgb)*select(1.0,0.0,frame.hidden.y!=0.0),haze.a);
}`,
    [CLOUD_HAZE_WGSL, AIR_RAY_WGSL, preExposedWgsl('frame.preExposure.x'), FULLSCREEN_VERTEX],
    shape,
  )
