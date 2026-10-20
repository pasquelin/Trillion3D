import { BLOOM_UP_ROW, bloomTapText, type BloomTap } from './bloomFilter.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'

/** The bloom uniform: the shader's `Bloom` struct and the first word of each of its fields. */
const BLOOM_UNIFORM = fieldLayout('Bloom', [
  ['outTexel', 'vec2f'],
  ['inTexel', 'vec2f'],
  ['radius', 'f32'],
  ['keep', 'f32'],
  ['glow', 'f32'],
  ['fold', 'f32'],
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
  // The tent's folded reads lie `(1.5 − radius)/(3 − 2f)` from their texel (`tent`): a level's one
  // scalar of the radius, hoisted here.
  packed[base + BLOOM_UNIFORM.at.fold] = 1.5 - radius
}

/** A bilinear read of the level at `uv` plus `offset` texels of `stride`: every filter's tap. */
export const levelTap = (offset: string) => `fetchLevel(uv+${offset}*stride)`

/** The tent's nine taps, the product of its row with itself (`BLOOM_UP_ROW`), offsets in texels
 *  scaled by the radius. */
const TENT_TAPS = [-1, 0, 1].flatMap((y) =>
  [-1, 0, 1].map((x): BloomTap => [x, y, BLOOM_UP_ROW[x + 1] * BLOOM_UP_ROW[y + 1]]),
)

/**
 * One bloom level as a program reads it, at the bindings of group `group`: the level, its bilinear
 * sampler and the uniform slot, `outTexel` the inverse size written, `inTexel` the inverse size
 * read. `tent` reads the level through the upsample filter (`bloomFilter.ts`); `blendLevel` is the
 * bloom's last blend — `keep` of the image, `glow` of the first level's sum —, one text for the
 * `composite` pass of a bloom another pass follows and for the composition, which blends the
 * chain's last bloom (`BLOOM_COMPOSE_WGSL`).
 *
 * THE TENT: per axis three bilinear taps at `t − r`, `t`, `t + r` texels of the level of weights
 * `BLOOM_UP_ROW` = (¼, ½, ¼), the two axes multiplied. Up to a radius of 1 the middle tap's two
 * texels are its neighbours' (`c − a = 2r ≤ 2`), so it folds into them: with `i = floor(t)`,
 * `f = t − i`, `wa = 3 − 2f` and `wb = 1 + 2f` (four times the two reads' weights), the reads lie
 * at `i + wb·s` and `i + 2 − wa·s` texels, `s = fold / (wa·wb)`, `fold = 1.5 − r` per level
 * (`writeBloomSlot`): four reads, one reciprocal per axis, every two texels of a read inside one
 * pair, so exact in real arithmetic. At the default radius `fold` is 0.5 and the text is the closed
 * form it always was, to the bit. Past 1 the middle tap shares no pair, and the nine taps are read
 * as they are. The branch is on the uniform radius, never per pixel. The sampler clamps each
 * texel's index, so the edges fold as the taps do (`bloomTent.test.ts`).
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
fn tent(uv:vec2f)->vec4f{
if(bloom.radius>1.0){let stride=bloom.inTexel*bloom.radius;var c=vec4f(0.0);
${bloomTapText(TENT_TAPS, levelTap, 'vec2f')}
return c;}
let t=uv/bloom.inTexel-0.5;let i=floor(t);let f=t-i;
let wa=3.0-2.0*f;let wb=1.0+2.0*f;let s=bloom.fold/(wa*wb);
let a=(i+wb*s)*bloom.inTexel;let b=(i+2.0-wa*s)*bloom.inTexel;
return (fetchLevel(a)*(wa.x*wa.y)+fetchLevel(vec2f(b.x,a.y))*(wb.x*wa.y)
+fetchLevel(vec2f(a.x,b.y))*(wa.x*wb.y)+fetchLevel(b)*(wb.x*wb.y))*0.0625;
}
fn blendLevel(image:vec4f,pixel:vec2f)->vec4f{return image*bloom.keep+tent(pixel*bloom.outTexel)*bloom.glow;}`,
  )

/** The chain's last bloom blended in by the composition, group 1 beside its own: its one blend
 *  (`blendLevel`), in f32 straight into the composed value — no target between them. */
export const BLOOM_COMPOSE_WGSL = wgslBlock(
  'BLOOM_COMPOSE_WGSL',
  [bloomLevelWgsl(1)],
  `fn bloomed(image:vec4f,pixel:vec2f)->vec4f{return blendLevel(image,pixel);}`,
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
