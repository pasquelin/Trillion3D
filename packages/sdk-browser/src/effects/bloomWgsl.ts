import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';
import { BLOOM_DOWN_TAPS, BLOOM_UP_TAPS, bloomTapText } from './bloomFilter.ts';

/** Bytes of one bloom uniform slot, and the stride between slots: dynamic offsets align on 256. */
export const BLOOM_UNIFORM_BYTES = 32;
export const BLOOM_UNIFORM_STRIDE = 256;

const read = (offset: string) => `fetchLevel(uv+${offset}*stride)`;

/**
 * The bloom's three WebGPU programs (`bloomFilter.ts`), on premultiplied linear radiance, alpha
 * blurred with the colour so that a glow over the background composes as coverage:
 * - `down` filters the level above into this one with the 13-tap filter;
 * - `up` adds the level below, read through the tent, into this one (additive blending);
 * - `composite` blends the first level's sum into the image: `keep` of the image, `glow` of it.
 * `outTexel` is the inverse size written, `inTexel` the inverse size read.
 */
export const BLOOM_WGSL = `
struct Bloom{outTexel:vec2f,inTexel:vec2f,radius:f32,keep:f32,glow:f32,unused:f32,}
@group(0) @binding(0) var level:texture_2d<f32>;
@group(0) @binding(1) var linearClamp:sampler;
@group(0) @binding(2) var<uniform> bloom:Bloom;
@group(1) @binding(0) var scene:texture_2d<f32>;
${FULLSCREEN_VERTEX}
fn fetchLevel(uv:vec2f)->vec4f{return textureSampleLevel(level,linearClamp,uv,0.0);}
fn tent(uv:vec2f)->vec4f{let stride=bloom.inTexel*bloom.radius;var c=vec4f(0.0);
${bloomTapText(BLOOM_UP_TAPS, read, 'vec2f')}
return c;}
@fragment fn down(@builtin(position) pixel:vec4f)->@location(0) vec4f{
let uv=pixel.xy*bloom.outTexel;let stride=bloom.inTexel;var c=vec4f(0.0);
${bloomTapText(BLOOM_DOWN_TAPS, read, 'vec2f')}
return c;}
@fragment fn up(@builtin(position) pixel:vec4f)->@location(0) vec4f{return tent(pixel.xy*bloom.outTexel);}
@fragment fn composite(@builtin(position) pixel:vec4f)->@location(0) vec4f{
return textureLoad(scene,vec2i(pixel.xy),0)*bloom.keep+tent(pixel.xy*bloom.outTexel)*bloom.glow;}`;
