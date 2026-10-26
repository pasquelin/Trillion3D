/**
 * THE DITHER OF A TRACED SHADOW (`vsmFilterShadow`): a share strictly inside the penumbra — above a
 * quarter of a sixteenth, below 1 — moves by the pixel's blue noise over a fifteenth of the range, then is
 * held to [0, 1], which breaks up the banding of a share packed in four bits (`maskFormat.ts`) or of the
 * rays' few values. The local lights' projection applies it before it packs a share, a blended surface's
 * trace before it lights; a one-sample read, 0 or 1, never moves.
 */
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'

export const VSM_SHADOW_FILTER_WGSL = wgslBlock(
  'VSM_SHADOW_FILTER_WGSL',
  [],
  `
const VSM_SHADOW_NOISE_SCALE:f32=1.0/15.0;
/** \`share\` dithered by \`noise\` (the pixel's blue noise, [0, 1)). */
fn vsmFilterShadow(share:f32,noise:f32)->f32{
 if(share<=VSM_SHADOW_NOISE_SCALE/4.0||share>=1.0){return share;}
 return saturate(share+(noise-0.5)*VSM_SHADOW_NOISE_SCALE);
}`,
)
