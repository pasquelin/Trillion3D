import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { lightTraits } from './lightReachWgsl.ts'

/**
 * A LIGHT'S STRENGTH AS ITS VIEW READS IT (`lightStrength`): the intensity the light buffer holds, which is the light's own whatever the
 * image, times the factor of its blend with the inverse of the exposure (`SceneLight.inverseExposureBlend`, in
 * the light's `traits`, `exposureBlendOf`): 1 at a blend of 0, the exposure's inverse at 1, the geometric blend between
 * (`exp(-blend * ln exposure)`); 1 whatever the blend where no exposure is known (0 or less). The buffer is every view's, so the factor
 * is worked out where the strength is read, with the exposure of the view the pass draws: `exposure` is the WGSL expression of that
 * number — the exposure of the image, the pre-exposure its light is written multiplied by times the scale composition applies —, one
 * to a program, as `preExposedWgsl` has its factor. A light of no blend reads its intensity as it is. The logarithm is taken once an
 * invocation, by the first light that follows the exposure (`lightLogExposure`), and each such light then costs the one `exp`: the
 * exposure a measured view lights at is copied into its uniform on the GPU (`post/exposure/frame.ts`), so no CPU-written logarithm
 * could stand for it.
 */
export const lightStrengthWgsl = (exposure: string) =>
  wgslBlock(
    `lightStrengthWgsl(${exposure})`,
    [lightTraits],
    `var<private> logExposureHeld:bool=false;
var<private> logExposureKept:f32=0.0;
/** The natural logarithm of the exposure, taken once an invocation (every light it reads shares it); 0 where no exposure is known. */
fn lightLogExposure()->f32{
 if(!logExposureHeld){
  let exposure=${exposure};
  logExposureKept=select(0.0,log(exposure),exposure>0.0);
  logExposureHeld=true;
 }
 return logExposureKept;
}
fn lightStrength(light:DirectLight)->f32{
 let blend=exposureBlendOf(light);
 if(blend==0.0){return light.colorIntensity.w;}
 return light.colorIntensity.w*exp(-blend*lightLogExposure());
}`,
  )
