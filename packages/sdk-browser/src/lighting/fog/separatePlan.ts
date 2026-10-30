import type { ResolvedHeightFog } from '../../../../sdk-core/src/scene/core/fogHeight.ts'
import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'

/**
 * WHETHER AND HOW THE FOG IS DRAWN INTO TEXTURES OF ITS OWN (`separate.ts`): the pure decisions.
 */

/** The least luminance a texel is held to when the scattering blurs it. */
const LEAST_MAX_LUMINANCE = 0.1

/** How the fog is drawn into textures of its own in an image: the scene's scattering where it asks for
 *  it and the run allows it (the blur chain is built then, else the texture has one level), and the
 *  luminance a texel is held to in the blur. */
export interface SeparateFog {
  readonly scattering: ResolvedHeightFog['screenSpaceScattering']
  readonly maxLuminance: number
  /** Whether the blur chain's second level is filtered in time (`separateTemporal.ts`), and the weight of the new image in it. */
  readonly temporal: boolean
  readonly temporalWeight: number
}

/** The way the fog is drawn into textures of its own, none where it is drawn plainly: `on` always,
 *  `auto` where the scene's fog asks for the scattering and the run allows it. */
export function separateFogOf(
  settings: Pick<
    VolumetricFogValues,
    | 'fogSeparateComposition'
    | 'fogScreenSpaceScattering'
    | 'fogScreenSpaceScatteringMaxLuminance'
    | 'fogScreenSpaceScatteringTemporal'
    | 'fogScreenSpaceScatteringTemporalWeight'
  >,
  fog: ResolvedHeightFog | undefined,
): SeparateFog | undefined {
  const scattering = settings.fogScreenSpaceScattering ? fog?.screenSpaceScattering : undefined
  const mode = settings.fogSeparateComposition
  if (mode === 'off' || (mode === 'auto' && !scattering)) return undefined
  return {
    scattering,
    maxLuminance: Math.max(LEAST_MAX_LUMINANCE, settings.fogScreenSpaceScatteringMaxLuminance),
    temporal: !!scattering && settings.fogScreenSpaceScatteringTemporal,
    temporalWeight: settings.fogScreenSpaceScatteringTemporalWeight,
  }
}

/** The levels of the blurred texture of a fog `width` × `height` texels: one without the scattering,
 *  else down to the level whose smaller side is a texel or two (the last level is not made); the sides are at least a texel. */
export function blurMipCount(width: number, height: number, scattering: boolean) {
  if (!scattering) return 1
  const side = Math.min(width, height)
  return Math.max(1, Math.ceil(Math.log2(side)))
}

/** A step of the blur chain: the kind and the level it writes. */
export interface BlurStep {
  readonly kind: 'downsample' | 'filter' | 'blend'
  readonly level: number
}

/** The steps that build a chain of `mips` levels, in order: each level from the one above it by a
 *  4x4 box, each level filtered into a texture of its own, then each filtered level but the last
 *  blended with the next coarser filtered one into the chain. */
export function blurSteps(mips: number): BlurStep[] {
  const steps: BlurStep[] = []
  for (let level = 1; level < mips; level++) steps.push({ kind: 'downsample', level })
  for (let level = 1; level < mips; level++) steps.push({ kind: 'filter', level })
  for (let level = 1; level < mips - 1; level++) steps.push({ kind: 'blend', level })
  return steps
}
