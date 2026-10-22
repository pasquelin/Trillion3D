import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { FINISH_WGSL, GLOWED_PIXEL_WGSL } from '../../finish/finishWgsl.ts'

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
 if(setup.layers!=0.0){c=vec4f(c.rgb*localGainOf(c,floor(pixel.xy)*setup.outTexel),c.a);}
 var amount=1.0;
 if(setup.threshold>-1.0){amount=saturate((luminance(c.rgb)*finish.look.y-setup.threshold)*0.5);}
 return c*amount;
}`,
  [FINISH_WGSL, luminance, FULLSCREEN_VERTEX],
)

/**
 * The uniform of the composite, one `vec4f` each, the glow's look where the composition does not
 * add it (`FINISH`, `../../finish/finishLayout.ts`, has the same two):
 * - `keep`: what the image's colour is multiplied by where the glow took some of its light, its
 *   fourth word 1 where it applies;
 * - `dirt`: what the dirt mask multiplies the glow by, `1 + mask × dirt`, its fourth word 1 where a
 *   mask is drawn.
 */
export const BLOOM_LOOK = fieldLayout('Look', [
  ['keep', 'vec4f'],
  ['dirt', 'vec4f'],
] as const)
/** Bytes of the composite's uniform. */
export const BLOOM_LOOK_BYTES = BLOOM_LOOK.words * 4

/** The bindings of the composite, by the names the shader gives them. */
export const COMPOSITE_BINDINGS = { scene: 0, glow: 1, reader: 2, mask: 3, look: 4 } as const

/** The glow added to an image the next pass of the chain reads: the image's pixel and the glow read
 *  bilinearly at its place, with what the glow left the pixel (`keep`) and the dirt the mask shows
 *  (`dirt`), as the composition adds it (`glowedPixel`). */
export const BLOOM_COMPOSITE_WGSL = wgslProgram(
  `
${BLOOM_LOOK.wgsl}
@group(0) @binding(${COMPOSITE_BINDINGS.scene}) var scene:texture_2d<f32>;
@group(0) @binding(${COMPOSITE_BINDINGS.glow}) var glow:texture_2d<f32>;
@group(0) @binding(${COMPOSITE_BINDINGS.reader}) var reader:sampler;
@group(0) @binding(${COMPOSITE_BINDINGS.mask}) var dirtImage:texture_2d<f32>;
@group(0) @binding(${COMPOSITE_BINDINGS.look}) var<uniform> look:Look;
@fragment fn composite(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=pixel.xy/vec2f(textureDimensions(scene));
 var mask=vec3f(0.0);
 if(look.dirt.w!=0.0){mask=textureSampleLevel(dirtImage,reader,uv,0.0).rgb;}
 return glowedPixel(textureLoad(scene,vec2i(pixel.xy),0),look.keep,textureSampleLevel(glow,reader,uv,0.0),mask,look.dirt);
}`,
  [GLOWED_PIXEL_WGSL, FULLSCREEN_VERTEX],
)
