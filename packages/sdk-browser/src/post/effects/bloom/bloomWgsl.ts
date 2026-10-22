import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { FINISH_WGSL, WITH_GLOW_WGSL } from '../../finish/finishWgsl.ts'

/** The uniform of the bloom's setup: the inverse size of the image it writes, the threshold, and
 *  1 where the local exposure's layers are applied. */
export const BLOOM_SETUP = fieldLayout('Setup', [
  ['outTexel', 'vec2f'],
  ['threshold', 'f32'],
  ['layers', 'f32'],
] as const)
/** Bytes of a bloom's setup uniform. */
export const BLOOM_SETUP_BYTES = BLOOM_SETUP.words * 4

/**
 * The bloom's setup, one pixel of the half-size image to one of its own: the radiance with its
 * local exposure applied — the grid read at the pixel's corner, the finishing's group 1 —, then,
 * past a threshold above −1, scaled by how far its exposed luminance clears it, over two:
 * `saturate((luminance · exposure − threshold) / 2)`. What the bloom blurs is what the image will
 * show, not the radiance it was drawn at.
 */
export const BLOOM_SETUP_WGSL = wgslProgram(
  `
${BLOOM_SETUP.wgsl}
@group(0) @binding(0) var halfImage:texture_2d<f32>;
@group(0) @binding(1) var halfReader:sampler;
@group(0) @binding(2) var<uniform> setup:Setup;
@fragment fn bloomSetup(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 var c=textureSampleLevel(halfImage,halfReader,pixel.xy*setup.outTexel,0.0);
 if(setup.layers!=0.0){
  let gain=localGain(lightLog(c.rgb/max(c.a,1e-6)),floor(pixel.xy)*setup.outTexel);
  c=vec4f(c.rgb*gain,c.a);
 }
 var amount=1.0;
 if(setup.threshold>-1.0){amount=saturate((luminance(c.rgb)*finish.look.y-setup.threshold)*0.5);}
 return c*amount;
}`,
  [FINISH_WGSL, luminance, FULLSCREEN_VERTEX],
)

/** The glow added to an image the next pass of the chain reads: the image's pixel and the glow
 *  read bilinearly at its place (`withGlow`). */
export const BLOOM_COMPOSITE_WGSL = wgslProgram(
  `
@group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var glow:texture_2d<f32>;
@group(0) @binding(2) var reader:sampler;
@fragment fn composite(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let size=vec2f(textureDimensions(scene));
 return withGlow(textureLoad(scene,vec2i(pixel.xy),0),textureSampleLevel(glow,reader,pixel.xy/size,0.0));
}`,
  [WITH_GLOW_WGSL, FULLSCREEN_VERTEX],
)
