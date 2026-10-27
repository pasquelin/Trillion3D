import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { TV_SH_WGSL } from '../translucency/frameWgsl.ts'
import { GI_SAMPLE_WGSL } from '../translucencyGi/frameWgsl.ts'

/**
 * THE TRANSLUCENCY VOLUME'S LIGHT IN THE FOG (`fogGiShown`, `fogGiLight`), which the scatter of a cell takes in the place of the sky light's
 * where the image made a volume (`frame.giGrid.w`). The volume the fog reads is the light before its history and its intensity
 * (`integrateWgsl.ts` of the volume): the ambient light in the first half of its slices and, in the second, the three linear bands as one weight
 * each. The point's cell is found as the surfaces find theirs (`giVolumeCoord` on the point's clip position, the slices and their law in the
 * frame) and its two halves read trilinear through the volumes' sampler (`giSampleVolume`, `fogGiVolume`, `fogSampler`). The two-band harmonics
 * are rebuilt from them — the constant band as it is, the linear ones the weights times the ambient light's colour, the ambient light over its
 * luminance (`tvNormalisedAmbient`) — and dotted with the phase's zonal harmonic along the camera vector, from the eye to the point, `(1, y, z, x)`
 * of it times `(1, g, g, g)` (`g` the medium's distribution), never negative. The program declares the frame (`frame`), the volume
 * (`fogGiVolume`) and the sampler.
 */
export const FOG_GI_WGSL = wgslBlock(
  'FOG_GI_WGSL',
  [GI_SAMPLE_WGSL, TV_SH_WGSL, luminance],
  `fn fogGiShown()->bool{return frame.giGrid.w>0.5;}
fn fogGiLight(P:vec3f,toEye:vec3f)->vec3f{
 let slices=frame.giGrid.z;
 let light=giSampleVolume(fogGiVolume,fogSampler,giVolumeCoord(frame.viewProj*vec4f(P,1.0),frame.giZ,slices),slices);
 let tint=tvNormalisedAmbient(light[0],luminance(light[0]));
 let along=dot(light[1],vec3f(-toEye.y,-toEye.z,-toEye.x))*frame.medium.x;
 return max(light[0]+tint*along,vec3f(0.0));
}`,
)
