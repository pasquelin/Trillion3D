import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import type { TranslucentMarkSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import { BOUNCE_GRID_STRUCTS_WGSL } from '../gridWgsl.ts'
import { markPoint } from './poolMarkWgsl.ts'

/**
 * THE TRANSLUCENT SURFACES' MARK OF THE RADIANCE CACHE (`TranslucentMarker`): the cells a translucent surface reads are marked by the
 * surface itself, not by the opaque pixel behind it. The meshes of the translucent surfaces that are lit per surface are drawn once more, at
 * the view's size divided by `downsample`, before the pool's kernels and after the bitmap of the marks is cleared; no depth is tested nor
 * written and no colour kept — each fragment, unless the opaque surfaces hide it (`translucentMarkHidden`), marks the eight probes round its
 * point in the level that picks it (`markTranslucent`), the very bitmap and the very rule as the opaque surfaces' (`markPointOver`), the level's
 * edge fading over the translucent mark's own number of probes. The fragment stage is the translucent pass's; what lives here is what the
 * cache gives it: the parameters, the target's size and the fragment's functions.
 */

/** The translucent mark's parameters (`translucentMark`): `size`, the target's extent in pixels (the pixel of a fragment over it is its place in the view); `invFade`, the
 *  inverse of the probes a level's edge fades over; `hizMip`, the level of the opaque depth pyramid the test reads; `hizTest`, whether the test runs. */
export const TRANSLUCENT_MARK_PARAMS = fieldLayout('TranslucentMarkParams', [
  ['size', 'vec2f'],
  ['invFade', 'f32'],
  ['hizMip', 'f32'],
  ['hizTest', 'u32'],
] as const)
/** Bytes of the translucent mark's parameters. */
export const TRANSLUCENT_MARK_PARAMS_BYTES = TRANSLUCENT_MARK_PARAMS.words * 4

/** Where a program binds what the fragment reads and writes, in one group: the parameters, the levels' uniform and the marks' bitmap. */
export const TRANSLUCENT_MARK_BINDINGS = { params: 0, grid: 1, marks: 2 } as const

/** The extent of the target the meshes are drawn at: the view's, divided by the downsample, a pixel more where it does not divide. */
export const translucentMarkTarget = (viewport: readonly number[], downsample: number) =>
  [ceilDiv(viewport[0], downsample), ceilDiv(viewport[1], downsample)] as const

/**
 * The fragment's functions, for a program of the translucent pass that binds the parameters (`translucentMark`), the levels' uniform (`bounce`)
 * and the bitmap (`marks`) at `at` in `group`: `translucentMarkUv`, where a fragment of the downsampled target lies in the view (0 to 1);
 * `translucentMarkHidden`, whether a fragment at view depth `viewDepth` is behind the opaque surfaces, whose farthest view depth in the pyramid's
 * texel at that place (read at `translucentMark.hizMip`) is `farthest` — hidden marks nothing; `markTranslucent`, the mark of the point `P` of
 * the fragment at `position` (its pixel, centre included), the level picked with the interleaved gradient noise of the pixel and the frame
 * modulo eight.
 */
export const translucentMark = (group: number, at = TRANSLUCENT_MARK_BINDINGS) =>
  wgslBlock(
    `translucentMark(${group},${at.params},${at.grid},${at.marks})`,
    [BOUNCE_GRID_STRUCTS_WGSL, markPoint(at.marks, group), interleavedGradientNoise],
    `${TRANSLUCENT_MARK_PARAMS.wgsl}
@group(${group}) @binding(${at.params}) var<uniform> translucentMark:TranslucentMarkParams;
@group(${group}) @binding(${at.grid}) var<uniform> bounce:BounceGrid;
fn translucentMarkUv(position:vec2f)->vec2f{return position/translucentMark.size;}
fn translucentMarkHidden(viewDepth:f32,farthest:f32)->bool{return translucentMark.hizTest!=0u&&viewDepth>=farthest;}
fn markTranslucent(position:vec2f,P:vec3f){
 if(bounce.counts.w==0u){return;}
 markPointOver(P,interleavedGradientNoise(position,f32(bounce.frame.z%8u)),0u,translucentMark.invFade);
}`,
  )

/** The writer of the translucent mark's parameters (`TRANSLUCENT_MARK_PARAMS`) into `buffer`: the settings and the view's size, which the
 *  target is the downsample of. */
export function createTranslucentMarkParams(device: GPUDevice, buffer: GPUBuffer) {
  const { u: words, f: floats } = wordViews(new ArrayBuffer(TRANSLUCENT_MARK_PARAMS_BYTES))
  const P = TRANSLUCENT_MARK_PARAMS.at
  return (settings: TranslucentMarkSettings, viewport: readonly number[]) => {
    const [width, height] = translucentMarkTarget(viewport, settings.downsample)
    floats[P.size] = width
    floats[P.size + 1] = height
    floats[P.invFade] = settings.invFade
    floats[P.hizMip] = settings.hizMip
    words[P.hizTest] = settings.hizTest ? 1 : 0
    writeChanged(device, buffer, words, 0, TRANSLUCENT_MARK_PARAMS.words)
  }
}
