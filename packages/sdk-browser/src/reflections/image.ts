import { REFLECTION_RADIANCE_PASS } from '../stage/passLabels.ts'
import { REFLECTION_COUNTS } from './constants.ts'
import type { ScreenReflection } from './gpu.ts'
import { drawnFromHeld, type RadianceStages } from './radiance.ts'
import { encodeRadiancePyramid, type RadianceInputs } from './radianceBuild.ts'
import type { ReflectionFrame } from './viewWrite.ts'

/**
 * THE BOOKKEEPING OF A REFLECTED IMAGE, the engine's (`frame.ts`) and every proof's alike: what the
 * image tells its view, then the radiance of its lit image and the settle's count of it.
 */

/**
 * Stages the reflection view of the image `frame` describes (`ScreenReflection.writeView`), under
 * the lights of epoch `lights`. Whether the image is drawn from where the held one was — its size
 * and view-projection — is decided here, once (`drawnFromHeld`, kept as `reflection.still` for its
 * radiance build). An image drawn from elsewhere, or under other lights, is drawn for a change: the
 * accumulation clamps on it, and the quiet images after it freeze the history (`temporalWgsl.ts`).
 * The turn moves on while the history fills, and holds once it is frozen: a still view writes nothing.
 */
export function stageReflectionImage(
  reflection: ScreenReflection,
  frame: ReflectionFrame,
  lights: number,
) {
  const { held, levels } = reflection.radiance
  reflection.still = drawnFromHeld(held, frame.size, frame.viewProjection)
  if (!reflection.still || lights !== reflection.lightsSeen) reflection.settle.busy()
  reflection.lightsSeen = lights
  frame.quiet = Math.min(reflection.settle.quiet, REFLECTION_COUNTS.REFLECTION_HISTORY)
  if (frame.quiet < REFLECTION_COUNTS.REFLECTION_HISTORY)
    reflection.turn = (reflection.turn + 1) % REFLECTION_COUNTS.REFLECTION_SEQUENCE
  frame.turn = reflection.turn
  reflection.writeView(frame, held, levels)
}

/** The radiance pyramid of the image's lit colour (`encodeRadiancePyramid`) drawn at `size` through
 *  `viewProjection`, in a compute pass of its own in `encoder`, hashed where the image is still and
 *  the view not yet settled — a settled view samples no hash —, then counted by the settle
 *  (`RadianceSettle.image`). */
export function encodeImageRadiance(
  encoder: GPUCommandEncoder,
  reflection: ScreenReflection,
  stages: RadianceStages,
  inputs: RadianceInputs,
  size: readonly [number, number],
  viewProjection: ArrayLike<number>,
) {
  const pass = encoder.beginComputePass({ label: REFLECTION_RADIANCE_PASS })
  encodeRadiancePyramid(
    pass,
    reflection.device,
    reflection.radiance,
    stages,
    inputs,
    size,
    viewProjection,
    reflection.still,
    reflection.settle.verified,
  )
  pass.end()
  reflection.settle.image(encoder, reflection.radiance.hashed)
}
