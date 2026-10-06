import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts'
import { BLOOM_DOWN_TAPS, bloomTapText } from '../../effects/bloomFilter.ts'
import { bloomLevelWgsl, levelTap } from '../../effects/bloomLevel.ts'

/**
 * The bloom's three WebGPU programs (`bloomFilter.ts`), on premultiplied linear radiance, alpha
 * blurred with the colour so that a glow over the background composes as coverage:
 * - `down` filters the level above into this one with the 13-tap filter;
 * - `up` adds the level below, read through the tent, into this one (additive blending);
 * - `composite` blends the first level's sum into the image (`blendLevel`).
 * The filters stay f32 on a device granted `shader-f16` (#963): a bilinear tap is an f32 blend of
 * half texels that a half operand would round, which changes levels and pixels (`bloomHalf.test.ts`).
 */
export const BLOOM_WGSL = `
${bloomLevelWgsl(0)}
@group(1) @binding(0) var scene:texture_2d<f32>;
${FULLSCREEN_VERTEX}
@fragment fn down(@builtin(position) pixel:vec4f)->@location(0) vec4f{
let uv=pixel.xy*bloom.outTexel;let stride=bloom.inTexel;var c=vec4f(0.0);
${bloomTapText(BLOOM_DOWN_TAPS, levelTap, 'vec2f')}
return c;}
@fragment fn up(@builtin(position) pixel:vec4f)->@location(0) vec4f{return tent(pixel.xy*bloom.outTexel);}
@fragment fn composite(@builtin(position) pixel:vec4f)->@location(0) vec4f{
return blendLevel(textureLoad(scene,vec2i(pixel.xy),0),pixel.xy);}`
