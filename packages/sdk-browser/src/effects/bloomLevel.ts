import { BLOOM_UP_TAPS, bloomTapText } from './bloomFilter.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'

/** Bytes of one bloom uniform slot, and the stride between slots: dynamic offsets align on 256. */
export const BLOOM_UNIFORM_BYTES = 32
export const BLOOM_UNIFORM_STRIDE = 256

/** A bilinear read of the level at `uv` plus `offset` texels of `stride`: every filter's tap. */
export const levelTap = (offset: string) => `fetchLevel(uv+${offset}*stride)`

/**
 * One bloom level as a program reads it, at the bindings of group `group`: the level, its bilinear
 * sampler and the uniform slot, `outTexel` the inverse size written, `inTexel` the inverse size
 * read. `tent` reads the level through the upsample filter (`bloomFilter.ts`); `blendLevel` is the
 * bloom's last blend — `keep` of the image, `glow` of the first level's sum —, one text for the
 * bloom's own `composite` pass and for the composition that takes that pass over.
 *
 * `tent9` is the filter itself, nine bilinear taps spread by `radius`. At the default radius, 1,
 * `tent4` is the same kernel in four taps, exact in real arithmetic: a pixel `f` texels past texel
 * `i` of the level reads two per axis, of weights `(3−2f)/4` and `(1+2f)/4`, at `i + (1+2f)r` and
 * `i + 2 − (3−2f)r` texels, `r = ½ / ((3−2f)(1+2f))`; the weights are scaled by 4 per axis, the
 * product by `1/16`. A sampler holds a tap's weights to a few bits, so on a device the two differ
 * by at most 2 · 2^-bits times the largest step between neighbouring texels the taps read. The
 * derivation, its proof and that bound are `bloomTent.test.ts`'s.
 */
export const bloomLevelWgsl = (group: number) => `
struct Bloom{outTexel:vec2f,inTexel:vec2f,radius:f32,keep:f32,glow:f32,unused:f32,}
@group(${group}) @binding(0) var level:texture_2d<f32>;
@group(${group}) @binding(1) var linearClamp:sampler;
@group(${group}) @binding(2) var<uniform> bloom:Bloom;
fn fetchLevel(uv:vec2f)->vec4f{return textureSampleLevel(level,linearClamp,uv,0.0);}
fn tent9(uv:vec2f)->vec4f{let stride=bloom.inTexel*bloom.radius;var c=vec4f(0.0);
${bloomTapText(BLOOM_UP_TAPS, levelTap, 'vec2f')}
return c;}
fn tent4(uv:vec2f)->vec4f{
let t=uv/bloom.inTexel-0.5;let i=floor(t);let f=t-i;
let wa=3.0-2.0*f;let wb=1.0+2.0*f;let r=0.5/(wa*wb);
let a=(i+wb*r)*bloom.inTexel;let b=(i+2.0-wa*r)*bloom.inTexel;
return (fetchLevel(a)*(wa.x*wa.y)+fetchLevel(vec2f(b.x,a.y))*(wb.x*wa.y)
+fetchLevel(vec2f(a.x,b.y))*(wa.x*wb.y)+fetchLevel(b)*(wb.x*wb.y))*0.0625;
}
fn tent(uv:vec2f)->vec4f{if(bloom.radius!=1.0){return tent9(uv);}return tent4(uv);}
fn blendLevel(image:vec4f,pixel:vec2f)->vec4f{return image*bloom.keep+tent(pixel*bloom.outTexel)*bloom.glow;}`

/**
 * The last blend as the composition reads it, group 1 beside the composition's own: the
 * value `composite` stored in its `rgba16float` target, rounded as that target rounded it, so the
 * composed image is the one the target gave, with one full-screen pass and target fewer. A value
 * the half range holds is rounded by `quantizeToF16`, fed only finite halves since it is
 * indeterminate past them; one the target turned infinite or kept not a number (|v| from 65520 on,
 * ±Inf, NaN) leaves as that: `v` times the largest `f32`'s order overflows to its signed infinity,
 * and a NaN stays a NaN. Those edges hold on IEEE arithmetic, as the target's own store did: WGSL
 * lets a compiler assume no infinity nor NaN, and then neither path is defined.
 */
export const BLOOM_COMPOSE_WGSL = `${bloomLevelWgsl(1)}
fn bloomed(image:vec4f,pixel:vec2f)->vec4f{let v=blendLevel(image,pixel);let held=abs(v)<vec4f(65520.0);
return select(v*3.4e38,quantizeToF16(clamp(select(vec4f(0.0),v,held),vec4f(-65504.0),vec4f(65504.0))),held);}`

/** The layout of a level's group, one per device: the bloom's passes and the composition that
 *  blends its last level in bind the same groups. */
export const bloomLevelLayout = oncePerDevice((device) => {
  const visibility = GPUShaderStage.FRAGMENT
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
  })
})
