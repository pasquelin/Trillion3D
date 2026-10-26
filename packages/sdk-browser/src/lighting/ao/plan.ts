import { alignUp, ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { AO_OCCLUSION_FORMAT, AO_SETUP_FORMAT } from './layout.ts'

/**
 * THE PASSES OF AN IMAGE'S OCCLUSION, in the order they are drawn (`aoPasses`): the search runs at the
 * image's size and at its half and its quarter, as many resolutions as the quality asks (`levels`, 1 to
 * 3). Each coarser resolution begins with a setup that halves the surfaces' normals and depths
 * (`setup`), and a search over them (`step`); the last pass, at the image's size, reads the surfaces
 * themselves, blends the coarser result into its own (`final`) and writes the texture the lighting reads;
 * one resolution is that last pass alone, or, smoothed (`aoPasses`), the last pass and the smoothing of its result. The taps of a search read the depth pyramid's cells, the farthest opaque
 * depth of a block of pixels, so that no map of them is made. The search draws into the textures `AO_TARGETS` names.
 */
export type AoTarget = 'setup1' | 'setup2' | 'ao2' | 'ao1' | 'raw' | 'ao'

/** A pass of the plan. */
export interface AoPass {
  kind: 'setup' | 'step' | 'final' | 'smooth'
  /** The texture it draws. */
  target: AoTarget
  /** The setup texture it reads: a step's own normals and depths, a final pass's, for the coarser result's neighbours. */
  setup?: AoTarget
  /** The coarser result it blends in. */
  lower?: AoTarget
}

/** What a target is: the scene's pixels one of its pixels stands for, and the format it is drawn in. */
export const AO_TARGETS: Readonly<
  Record<AoTarget, { scale: 1 | 2 | 4; format: GPUTextureFormat }>
> = {
  setup1: { scale: 2, format: AO_SETUP_FORMAT },
  setup2: { scale: 4, format: AO_SETUP_FORMAT },
  ao2: { scale: 4, format: AO_OCCLUSION_FORMAT },
  ao1: { scale: 2, format: AO_OCCLUSION_FORMAT },
  raw: { scale: 1, format: AO_OCCLUSION_FORMAT },
  ao: { scale: 1, format: AO_OCCLUSION_FORMAT },
}

/** The passes of `levels` resolutions (1 to 3), in the order they are drawn; `smooth`, with one resolution, a smoothing pass
 *  over the last one's result, which then draws into a texture of its own (`raw`). */
export function aoPasses(levels: number, smooth = false): AoPass[] {
  if (levels <= 1)
    return smooth
      ? [
          { kind: 'final', target: 'raw' },
          { kind: 'smooth', target: 'ao', lower: 'raw' },
        ]
      : [{ kind: 'final', target: 'ao' }]
  const passes: AoPass[] = [{ kind: 'setup', target: 'setup1' }]
  if (levels >= 3)
    passes.push(
      { kind: 'setup', target: 'setup2' },
      { kind: 'step', target: 'ao2', setup: 'setup2' },
    )
  passes.push(
    { kind: 'step', target: 'ao1', setup: 'setup1', ...(levels >= 3 ? { lower: 'ao2' } : {}) },
    { kind: 'final', target: 'ao', setup: 'setup1', lower: 'ao1' },
  )
  return passes
}

/** The side of the scene's textures the passes' are cut from: the least multiple of eight over the
 *  size the render targets are made at, so that the half and the quarter are whole pixels. */
export const aoExtentOf = (allocated: readonly [number, number]): [number, number] => [
  alignUp(Math.max(1, allocated[0]), 8),
  alignUp(Math.max(1, allocated[1]), 8),
]

/** The size of a texture `scale` times smaller than a scene of `extent`. */
export const scaledExtent = (scale: number, extent: readonly [number, number]) =>
  [extent[0] / scale, extent[1] / scale] as const

/** The rectangle a texture `scale` times smaller is drawn in when the image is `view` pixels: the share of the texture it
 *  covers, written into `into` from `at` — the caller's own array or words —, and returned. */
export function scaledRect<T extends { [index: number]: number }>(
  scale: number,
  view: readonly [number, number],
  into: T,
  at = 0,
) {
  into[at] = ceilDiv(view[0], scale)
  into[at + 1] = ceilDiv(view[1], scale)
  return into
}

/** The texture of `target` over a scene of `extent`: its size. */
export const aoTargetExtent = (target: AoTarget, extent: readonly [number, number]) =>
  scaledExtent(AO_TARGETS[target].scale, extent)

/** The rectangle `target` is drawn in when the image is `view` pixels. */
export const aoTargetRect = (
  target: AoTarget,
  view: readonly [number, number],
  into: number[] = [0, 0],
) => scaledRect(AO_TARGETS[target].scale, view, into)
