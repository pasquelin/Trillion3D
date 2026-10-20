/**
 * THE BOOKKEEPING OF A REFLECTED IMAGE, the engine's (`frame.ts`) and every proof's alike: what the
 * image tells its view, then the radiance of its lit image.
 */
import { REFLECTION_RADIANCE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { REFLECTION_SEQUENCE } from './constants.ts'
import type { ScreenReflection } from './gpu.ts'
import type { RadianceStages } from './radiance/radiance.ts'
import { encodeRadiancePyramid, type RadianceInputs } from './radiance/radianceBuild.ts'
import type { ReflectionFrame } from './viewWrite.ts'

/**
 * Stages the reflection view of the image `frame` describes (`ScreenReflection.writeView`). Every
 * image takes the next turn of the view's sample sequence, still or moving: the image's index modulo
 * the sequence's length, so a still view's history averages every direction of it.
 */
export function stageReflectionImage(reflection: ScreenReflection, frame: ReflectionFrame) {
  const { held, levels } = reflection.radiance
  reflection.turn = (reflection.turn + 1) % REFLECTION_SEQUENCE
  frame.turn = reflection.turn
  reflection.writeView(frame, held, levels)
}

/** The radiance pyramid of the image's lit colour (`encodeRadiancePyramid`) of the staged `frame` —
 *  its size and view-projection —, in a compute pass of its own in `encoder`, every image. */
export function encodeImageRadiance(
  encoder: GPUCommandEncoder,
  reflection: ScreenReflection,
  stages: RadianceStages,
  inputs: RadianceInputs,
  frame: ReflectionFrame,
) {
  const pass = encoder.beginComputePass({ label: REFLECTION_RADIANCE_PASS })
  encodeRadiancePyramid(
    pass,
    reflection.device,
    reflection.radiance,
    stages,
    inputs,
    frame.size,
    frame.viewProjection,
  )
  pass.end()
}
