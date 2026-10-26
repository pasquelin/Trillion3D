import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SKY_DIFFUSE_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'
import { GI_LIGHT_WGSL, GI_SAMPLE_WGSL } from './frameWgsl.ts'

/**
 * THE INDIRECT LIGHT A SEE-THROUGH SURFACE TAKES, in the fragment stage of the blends, the water and the transmissive stages: one filtered fetch
 * of the volume (`translucentGiIrradiance`) in place of a gather of the world's probes. The point's cell is found as the grid's law finds it
 * (`giVolumeCoord` on the point's clip position, `BlendView.giZ` the slices' law, `giGrid` the cells' depth in `z` and, in `w`, whether a
 * volume is made this image) and its two bands read trilinear (`giSampleVolume`); the irradiance of a normal is the harmonics' times the
 * cosine lobe's (`giIrradiance`), the constant band alone for a surface lit as a medium (`translucentGiSingle`). The last half slice of the
 * grid fades to the sky light's irradiance (read only where the fade is not whole), which is also all a point reads where no volume is
 * made, none where no sky light shines. What a surface gives back of it is the albedo times the irradiance (`lambertDiffuse`), the caller's.
 * The program names the volume's texture and sampler (`binding`, `sampler`, group 0) and the view's uniform (`uni`, `BlendView`).
 */
export const translucentGiWgsl = (binding: number, sampler: number) =>
  wgslBlock(
    `translucentGiWgsl(${binding}, ${sampler})`,
    [GI_SAMPLE_WGSL, GI_LIGHT_WGSL, SKY_DIFFUSE_READ_WGSL],
    `@group(0) @binding(${binding}) var translucencyGi:texture_3d<f32>;
@group(0) @binding(${sampler}) var translucencyGiSampler:sampler;
/** Whether the surface in hand reads the constant band alone (a material lit as a medium without direction), set with its other state. */
var<private> translucentGiSingle:bool=false;
/** What the environment adds of the sky light's diffuse: nothing, the volume carries it (the shared lighting helpers read it). */
fn environmentSky(N:vec3f)->vec3f{return vec3f(0.0);}
/** The sky light's irradiance on a surface of normal \`N\`, none where no sky light shines. */
fn translucentSky(N:vec3f)->vec3f{return select(vec3f(0.0),skyIrradiance(N),skyLit());}
/** The irradiance at \`P\` on a surface of normal \`N\`: the volume's, fading to the sky light's over the grid's last half slice. */
fn translucentGiIrradiance(P:vec3f,N:vec3f,single:bool)->vec3f{
 if(uni.giGrid.w==0.0){return translucentSky(N);}
 let clip=uni.viewProj*vec4f(P,1.0);
 if(clip.w<=0.0){return translucentSky(N);}
 let slices=uni.giGrid.z;
 let uvw=giVolumeCoord(clip,uni.giZ,slices);
 let fade=saturate((1.0-uvw.z)*(slices/0.5));
 if(fade<=0.0){return translucentSky(N);}
 let volume=giIrradiance(giSampleVolume(translucencyGi,translucencyGiSampler,uvw,slices),N,single);
 if(fade>=1.0){return volume;}
 return mix(translucentSky(N),volume,fade);
}
/** The irradiance on the back of a thin two-sided surface (\`thinBack\`): the volume's, read along the opposite normal. */
fn indirectIrradiance(P:vec3f,N:vec3f)->vec3f{return translucentGiIrradiance(P,N,translucentGiSingle);}`,
  )
