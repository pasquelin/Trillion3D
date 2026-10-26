import { fieldLayout, vec4Array } from '../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { GAUSSIAN_MAX_TAPS } from './gaussianKernel.ts'

/** How a read past the image is taken: as the nearest texel, as zero, or mirrored back. */
export const BLUR_EDGES = { clamp: 0, zero: 1, mirror: 2 } as const

/**
 * The uniform of one blur pass. `axis` is the step of one texel of offset, in the image's
 * coordinates, along the pass's axis; `inTexel` the inverse size of the image read, `outTexel`
 * that of the image written, and `scale` the share of the texture the image read fills, along
 * each axis — an image drawn into the corner of a larger texture —; `count` the reads; `edge` how
 * a read past the image is taken (`BLUR_EDGES`); `plus` 1 where an image is added to the sum.
 * `taps` holds each read's offset in texels and its weight per colour channel.
 */
export const BLUR_PARAMS = fieldLayout('Blur', [
  ['axis', 'vec2f'],
  ['inTexel', 'vec2f'],
  ['outTexel', 'vec2f'],
  ['scale', 'vec2f'],
  ['count', 'f32'],
  ['edge', 'f32'],
  ['plus', 'f32'],
  ['taps', vec4Array(GAUSSIAN_MAX_TAPS)],
] as const)
/** Bytes of one blur pass's uniform. */
export const BLUR_BYTES = BLUR_PARAMS.words * 4

/**
 * One pass of a separable Gaussian blur, on radiance whose alpha is blurred with its colour: the
 * sum of the reads, each weighted per channel — the alpha by the mean of the three weights —, plus the image added, read at the pixel. The sampler clamps to the
 * edge of the texture; a read past the image `edge` takes otherwise: at the nearest texel of the
 * image and scaled by how far inside it was, which is what a border colour of zero gives, or at
 * the point the edge mirrors it to. The image fills `scale` of its texture's width, so every read
 * is first brought into the image, to its outermost texel centres: the texels of the texture
 * beyond it were never written, and the sampler must not blend with them.
 */
export const GAUSSIAN_WGSL = wgslProgram(
  `
${BLUR_PARAMS.wgsl}
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var reader:sampler;
@group(0) @binding(2) var<uniform> blur:Blur;
@group(0) @binding(3) var extra:texture_2d<f32>;
fn mirrored(x:vec2f)->vec2f{
 let folded=abs(x)-2.0*floor(abs(x)*0.5);
 return select(folded,vec2f(2.0)-folded,folded>vec2f(1.0));
}
fn fetch(uv:vec2f)->vec4f{
 let inner=blur.inTexel*0.5;
 let outer=vec2f(1.0)-inner;
 if(blur.edge==0.0){return textureSampleLevel(image,reader,clamp(uv,inner,outer)*blur.scale,0.0);}
 if(blur.edge==2.0){return textureSampleLevel(image,reader,clamp(mirrored(uv),inner,outer)*blur.scale,0.0);}
 let at=clamp(uv,inner,outer);
 let inside=saturate(vec2f(1.0)-abs(at-uv)/blur.inTexel);
 return textureSampleLevel(image,reader,at*blur.scale,0.0)*(inside.x*inside.y);
}
@fragment fn blurTaps(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=pixel.xy*blur.outTexel;
 var sum=vec4f(0.0);
 for(var i=0u;i<u32(blur.count);i++){
  let tap=blur.taps[i];
  sum+=fetch(uv+blur.axis*tap.x)*vec4f(tap.yzw,(tap.y+tap.z+tap.w)/3.0);
 }
 if(blur.plus!=0.0){sum+=textureSampleLevel(extra,reader,uv,0.0);}
 return sum;
}`,
  [FULLSCREEN_VERTEX],
)
