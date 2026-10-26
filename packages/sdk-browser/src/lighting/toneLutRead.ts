import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { linearToSrgb } from '../../../math/src/wgsl/color.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'
import { TONE_SHAPER_WGSL } from './toneBakeWgsl.ts'

/** Words of the table's reading uniform: one `vec4f`, the texel scale and offset, the shaper, the
 *  table's scale. */
export const TONE_READ_WORDS = 4

/**
 * How a pass reads the baked table (`toneBakeWgsl.ts`): the table, the sampler that interpolates it
 * between its texels and its reading uniform, `toneRead` — a code is scaled by the texels less one
 * over the texels and offset by half a texel over them, so that a code of 0 reads the middle of the
 * first texel and a code of 1 the middle of the last —, at the bindings `first`, `first + 1` and
 * `first + 2` of group 0. `toneShown` is the colour the display shows for the exposed light
 * `exposed` under the display curve of rank `curve`: the light addressed by the shaper, the table
 * read trilinearly and the scale taken back; under the curve `none`, which shows the light as it
 * is, only the sRGB transfer.
 */
export const toneReadWgsl = (first: number) =>
  wgslBlock(
    `toneReadWgsl(${first})`,
    [TONE_SHAPER_WGSL, linearToSrgb],
    `
@group(0) @binding(${first}) var toneTable:texture_3d<f32>;
@group(0) @binding(${first + 1}) var toneSampler:sampler;
@group(0) @binding(${first + 2}) var<uniform> toneRead:vec4f;
fn toneShown(exposed:vec3f,curve:u32)->vec3f{
 if(curve==${TONE_MAPPING_RANK.none}u){return linearToSrgb(exposed);}
 let at=shaperCode(exposed,toneRead.z)*toneRead.x+vec3f(toneRead.y);
 return textureSampleLevel(toneTable,toneSampler,at,0.0).rgb*toneRead.w;
}`,
  )

/** The layout entries of the table's reading, at the bindings `first` to `first + 2`, seen by the
 *  fragment stage. */
export const toneReadEntries = (first: number, visibility: number): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(first, 'float', '3d', visibility),
  computeSamplerEntry(first + 1, 'filtering', visibility),
  computeUniformEntry(first + 2, { minBindingSize: TONE_READ_WORDS * 4 }, visibility),
]
