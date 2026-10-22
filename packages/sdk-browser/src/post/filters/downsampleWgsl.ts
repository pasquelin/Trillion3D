import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts'

/** The uniform of a downsample pass: the inverse sizes of the image read and of the one written. */
export const DOWNSAMPLE_PARAMS = fieldLayout('Down', [
  ['inTexel', 'vec2f'],
  ['outTexel', 'vec2f'],
] as const)
/** Bytes of a downsample pass's uniform. */
export const DOWNSAMPLE_BYTES = DOWNSAMPLE_PARAMS.words * 4

/**
 * The two ways down one level, on premultiplied radiance, a sampler clamping to the edge so a
 * read past the image is its last texel: `halve` one bilinear read at the centre of the four
 * texels a pixel covers, their mean; `halveWide` four such reads, one texel out along each
 * diagonal, the mean of the 4 × 4 texels around — a wider box, which keeps a bright pixel from
 * flickering as it moves —, its colour held at 0 or more.
 */
export const DOWNSAMPLE_WGSL = wgslProgram(
  `
${DOWNSAMPLE_PARAMS.wgsl}
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var reader:sampler;
@group(0) @binding(2) var<uniform> down:Down;
@fragment fn halve(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 return textureSampleLevel(image,reader,pixel.xy*down.outTexel,0.0);
}
@fragment fn halveWide(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=pixel.xy*down.outTexel;
 let texel=down.inTexel;
 var sum=textureSampleLevel(image,reader,uv+texel*vec2f(-1.0,-1.0),0.0);
 sum+=textureSampleLevel(image,reader,uv+texel*vec2f(1.0,-1.0),0.0);
 sum+=textureSampleLevel(image,reader,uv+texel*vec2f(-1.0,1.0),0.0);
 sum+=textureSampleLevel(image,reader,uv+texel*vec2f(1.0,1.0),0.0);
 let mean=sum*0.25;
 return vec4f(max(mean.rgb,vec3f(0.0)),mean.a);
}`,
  [FULLSCREEN_VERTEX],
)
