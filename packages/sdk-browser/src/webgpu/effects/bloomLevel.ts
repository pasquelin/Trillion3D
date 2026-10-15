import { BLOOM_UP_ROW } from './bloomFilter.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FINITE_SENTINEL, HALF_MAX, HALF_OVERFLOW } from '../../../../math/src/wgsl/constants.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'

/** The bloom uniform: the shader's `Bloom` struct and the first word of each of its fields. */
const BLOOM_UNIFORM = fieldLayout('Bloom', [
  ['outTexel', 'vec2f'],
  ['inTexel', 'vec2f'],
  ['radius', 'f32'],
  ['keep', 'f32'],
  ['glow', 'f32'],
  ['unused', 'f32'],
])
/** Bytes of one bloom uniform slot; slots lie the device's `uniformStride` apart, the alignment
 *  of their dynamic offsets. */
export const BLOOM_UNIFORM_BYTES = BLOOM_UNIFORM.words * 4

/** Writes one `Bloom` slot into `packed` at word `base`: inverse sizes written and read, radius,
 *  blend. */
export function writeBloomSlot(
  packed: Float32Array,
  base: number,
  out: readonly [number, number],
  read: readonly [number, number],
  radius: number,
  keep: number,
  glow: number,
) {
  packed[base + BLOOM_UNIFORM.at.outTexel] = 1 / out[0]
  packed[base + BLOOM_UNIFORM.at.outTexel + 1] = 1 / out[1]
  packed[base + BLOOM_UNIFORM.at.inTexel] = 1 / read[0]
  packed[base + BLOOM_UNIFORM.at.inTexel + 1] = 1 / read[1]
  packed[base + BLOOM_UNIFORM.at.radius] = radius
  packed[base + BLOOM_UNIFORM.at.keep] = keep
  packed[base + BLOOM_UNIFORM.at.glow] = glow
}

/** A bilinear read of the level at `uv` plus `offset` texels of `stride`: every filter's tap. */
export const levelTap = (offset: string) => `fetchLevel(uv+${offset}*stride)`

const [EDGE, MIDDLE] = BLOOM_UP_ROW
/** The tent's nine weighted reads, `x` the pairs of one axis and `y` of the other (`tentAxis`), a
 *  pair of weight zero read by none. */
const TENT_READS = ['x', 'y', 'z']
  .flatMap((j) =>
    ['x', 'y', 'z'].map(
      (i) =>
        `if(x.weight.${i}>0.0&&y.weight.${j}>0.0){c+=fetchLevel(vec2f(x.at.${i},y.at.${j})*bloom.inTexel)*(x.weight.${i}*y.weight.${j});}`,
    ),
  )
  .join('\n')

/**
 * One bloom level as a program reads it, at the bindings of group `group`: the level, its bilinear
 * sampler and the uniform slot, `outTexel` the inverse size written, `inTexel` the inverse size
 * read. `tent` reads the level through the upsample filter (`bloomFilter.ts`); `blendLevel` is the
 * bloom's last blend — `keep` of the image, `glow` of the first level's sum —, one text for the
 * bloom's own `composite` pass and for the composition that takes that pass over.
 *
 * THE TENT, ONE RULE AT EVERY RADIUS. Per axis it is three bilinear taps at `t − r`, `t`, `t + r`
 * texels of the level (`t` the pixel's position, texel `n`'s centre at `n`; `r` the radius) of
 * weights `BLOOM_UP_ROW`: texel `n` takes `Σ_k w_k · max(0, 1 − |t + k·r − n|)` (`tentTexel`), the
 * two axes multiplied. Two neighbouring texels of non-negative weights are one bilinear read at
 * their weighted centre, so the axis is read in pairs: the pair from texel
 * `n_p = max(floor(t − r) + 2p, floor(t + (p − 1)·r))`, `p = 0, 1, 2`. Below a radius of 2 the
 * texels of weight run from `floor(t − r)` over at most six, three pairs from the first; from 2 on
 * the three taps share no texel and each pair is a tap's own two; the `max` is the one of the two
 * that holds, both equal at 2. A pair of weight zero is not read: up to a radius of 1 the texels of
 * weight are four at most, and the tent costs four reads; past it, nine at most. The sampler clamps
 * each texel's index, so the edges fold as the taps do. Exact in real arithmetic; the sampler holds
 * a read's fraction to a few bits, which moves the result by at most `2^-bits` times the largest
 * step between neighbouring texels read (`bloomTent.test.ts`).
 */
export const bloomLevelWgsl = (group: number) =>
  wgslBlock(
    `bloomLevelWgsl(${group})`,
    [],
    `
${BLOOM_UNIFORM.wgsl}
@group(${group}) @binding(0) var level:texture_2d<f32>;
@group(${group}) @binding(1) var linearClamp:sampler;
@group(${group}) @binding(2) var<uniform> bloom:Bloom;
fn fetchLevel(uv:vec2f)->vec4f{return textureSampleLevel(level,linearClamp,uv,0.0);}
fn tentHat(x:vec3f)->vec3f{return max(vec3f(0.0),1.0-abs(x));}
fn tentTexel(t:f32,r:f32,n:vec3f)->vec3f{return ${wgslF32(EDGE)}*(tentHat(t-r-n)+tentHat(t+r-n))+${wgslF32(MIDDLE)}*tentHat(t-n);}
struct TentAxis{weight:vec3f,at:vec3f,}
fn tentAxis(t:f32,r:f32)->TentAxis{
let n=max(floor(t-r)+vec3f(0.0,2.0,4.0),floor(vec3f(t-r,t,t+r)));
let near=tentTexel(t,r,n);let far=tentTexel(t,r,n+1.0);let weight=near+far;
return TentAxis(weight,n+0.5+far/select(vec3f(1.0),weight,weight>vec3f(0.0)));
}
fn tent(uv:vec2f)->vec4f{
let t=uv/bloom.inTexel-0.5;let x=tentAxis(t.x,bloom.radius);let y=tentAxis(t.y,bloom.radius);
var c=vec4f(0.0);
${TENT_READS}
return c;
}
fn blendLevel(image:vec4f,pixel:vec2f)->vec4f{return image*bloom.keep+tent(pixel*bloom.outTexel)*bloom.glow;}`,
  )

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
export const BLOOM_COMPOSE_WGSL = wgslBlock(
  'BLOOM_COMPOSE_WGSL',
  [bloomLevelWgsl(1), FINITE_SENTINEL, HALF_MAX, HALF_OVERFLOW],
  `fn bloomed(image:vec4f,pixel:vec2f)->vec4f{let v=blendLevel(image,pixel);let held=abs(v)<vec4f(HALF_OVERFLOW);
return select(v*FINITE_SENTINEL,quantizeToF16(clamp(select(vec4f(0.0),v,held),vec4f(-HALF_MAX),vec4f(HALF_MAX))),held);}`,
)

/** The layout of a level's group, one per device: the bloom's passes and the composition that
 *  blends its last level in bind the same groups. */
export const bloomLevelLayout = oncePerDevice((device) => {
  const visibility = GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    label: 'Trillion3D bloom level',
    entries: [
      computeTextureEntry(0, 'float', '2d', visibility),
      computeSamplerEntry(1, 'filtering', visibility),
      computeUniformEntry(
        2,
        { hasDynamicOffset: true, minBindingSize: BLOOM_UNIFORM_BYTES },
        visibility,
      ),
    ],
  })
})
