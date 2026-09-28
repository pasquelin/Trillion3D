import { BLOOM_UP_TAPS, bloomTapText } from './bloomFilter.ts';
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts';

/** Bytes of one bloom uniform slot, and the stride between slots: dynamic offsets align on 256. */
export const BLOOM_UNIFORM_BYTES = 32;
export const BLOOM_UNIFORM_STRIDE = 256;

/** A bilinear read of the level at `uv` plus `offset` texels of `stride`: every filter's tap. */
export const levelTap = (offset: string) => `fetchLevel(uv+${offset}*stride)`;

/**
 * One bloom level as a program reads it, at the bindings of group `group`: the level, its bilinear
 * sampler and the uniform slot, `outTexel` the inverse size written, `inTexel` the inverse size
 * read. `tent` reads the level through the upsample filter (`bloomFilter.ts`); `blendLevel` is the
 * bloom's last blend — `keep` of the image, `glow` of the first level's sum —, one text for the
 * bloom's own `composite` pass and for the composition that takes that pass over (#963).
 */
export const bloomLevelWgsl = (group: number) => `
struct Bloom{outTexel:vec2f,inTexel:vec2f,radius:f32,keep:f32,glow:f32,unused:f32,}
@group(${group}) @binding(0) var level:texture_2d<f32>;
@group(${group}) @binding(1) var linearClamp:sampler;
@group(${group}) @binding(2) var<uniform> bloom:Bloom;
fn fetchLevel(uv:vec2f)->vec4f{return textureSampleLevel(level,linearClamp,uv,0.0);}
fn tent(uv:vec2f)->vec4f{let stride=bloom.inTexel*bloom.radius;var c=vec4f(0.0);
${bloomTapText(BLOOM_UP_TAPS, levelTap, 'vec2f')}
return c;}
fn blendLevel(image:vec4f,pixel:vec2f)->vec4f{return image*bloom.keep+tent(pixel*bloom.outTexel)*bloom.glow;}`;

/**
 * The last blend as the composition reads it (#963), group 1 beside the composition's own: the
 * value `composite` stored in its `rgba16float` target, rounded to half precision as that target
 * rounded it, so the composed image is the one the target gave, with one full-screen pass and
 * target fewer. The radiance is clamped to the largest half first — `quantizeToF16` of a value
 * past it is indeterminate —: the image and the levels hold half floats, so only an infinite
 * texel reaches it, which the target kept infinite and the composition reads as the largest half.
 */
export const BLOOM_COMPOSE_WGSL = `${bloomLevelWgsl(1)}
fn bloomed(image:vec4f,pixel:vec2f)->vec4f{return quantizeToF16(min(blendLevel(image,pixel),vec4f(65504.0)));}`;

/** The layout of a level's group, one per device: the bloom's passes and the composition that
 *  blends its last level in bind the same groups. */
export const bloomLevelLayout = oncePerDevice((device) => {
  const visibility = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    label: 'Trillion3D bloom level',
    entries: [
      { binding: 0, visibility, texture: { sampleType: 'float' } },
      { binding: 1, visibility, sampler: { type: 'filtering' } },
      {
        binding: 2,
        visibility,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: BLOOM_UNIFORM_BYTES },
      },
    ],
  });
});
