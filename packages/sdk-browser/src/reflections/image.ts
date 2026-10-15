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
 * and view-projection — is decided here, once (`drawnFromHeld`, kept as `frame.still` for its
 * radiance build). An image drawn from elsewhere, or under other lights, is drawn for a change: the
 * accumulation clamps on it. The quiet images after it are a still view's own series: the first
 * restarts the history, each takes the turn of its rank, and the history freezes once it holds
 * `REFLECTION_HISTORY` of them (`temporalWgsl.ts`) — so the image a still view holds is the mean of the
 * same samples of it whatever was drawn before, and a frozen view writes nothing, its turn held. An
 * image drawn for a change takes the next turn of the view's own count.
 */
export function stageReflectionImage(
  reflection: ScreenReflection,
  frame: ReflectionFrame,
  lights: number,
) {
  const { held, levels } = reflection.radiance
  frame.still = drawnFromHeld(held, frame.size, frame.viewProjection)
  if (!frame.still || lights !== reflection.lightsSeen) reflection.settle.busy()
  reflection.lightsSeen = lights
  const { REFLECTION_HISTORY, REFLECTION_SEQUENCE } = REFLECTION_COUNTS
  frame.quiet = Math.min(reflection.settle.quiet, REFLECTION_HISTORY)
  if (frame.quiet === 0) reflection.turn = (reflection.turn + 1) % REFLECTION_SEQUENCE
  frame.turn = frame.quiet || reflection.turn
  reflection.writeView(frame, held, levels)
}

/** The radiance pyramid of the image's lit colour (`encodeRadiancePyramid`) of the staged `frame` —
 *  its size, its view-projection, whether it is still —, in a compute pass of its own in `encoder`, hashed where the image is still and
 *  the view not yet settled — a settled view samples no hash —, then counted by the settle
 *  (`RadianceSettle.image`). */
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
    !!frame.still,
    reflection.settle.verified,
  )
  pass.end()
  reflection.settle.image(encoder, reflection.radiance.hashed)
}
