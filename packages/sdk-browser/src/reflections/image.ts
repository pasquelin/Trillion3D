import { REFLECTION_RADIANCE_PASS } from '../stage/passLabels.ts'
import { REFLECTION_COUNTS, REFLECTION_SEQUENCE } from './constants.ts'
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
 * radiance build). An image whose camera moved — its pose, the temporal accumulation's jitter aside —,
 * or drawn under other lights, is drawn for a move (`RadianceSettle.move`): the accumulation clamps on
 * it; a jitter is no move, so a still view under the temporal accumulation settles as one without.
 * The quiet images after a change are a still view's own series: the first restarts the history, each
 * takes the turn of its rank, and the history freezes once it holds `REFLECTION_STILL` of them
 * (`temporalWgsl.ts`) — so the image a still view holds is the mean of the same samples of it whatever
 * was drawn before, and a frozen view writes nothing, its turn held. An image drawn for a change takes
 * the next turn of the view's own count. Each image clears the trace's word the settle reads
 * (`RadianceSettle.stage`).
 */
export function stageReflectionImage(
  reflection: ScreenReflection,
  frame: ReflectionFrame,
  lights: number,
) {
  const { held, levels } = reflection.radiance
  frame.still = drawnFromHeld(held, frame.size, frame.viewProjection)
  const stands = drawnFromHeld(held, frame.size, frame.pose ?? frame.viewProjection, held.pose)
  if (!stands || lights !== reflection.lightsSeen) reflection.settle.move()
  reflection.settle.stage()
  reflection.lightsSeen = lights
  const { REFLECTION_STILL } = REFLECTION_COUNTS
  frame.moving = reflection.settle.moving
  frame.quiet = Math.min(reflection.settle.quiet, REFLECTION_STILL + 1)
  if (frame.quiet === 0) reflection.turn = (reflection.turn + 1) % REFLECTION_SEQUENCE
  frame.turn = frame.quiet || reflection.turn
  reflection.writeView(frame, held, levels)
}

/** The radiance pyramid of the image's lit colour (`encodeRadiancePyramid`) of the staged `frame` —
 *  its size, its view-projection, whether it is still —, in a compute pass of its own in `encoder`,
 *  hashed where the image is still and the view not yet settled — a settled view samples no hash —,
 *  then counted by the settle (`RadianceSettle.image`). A frozen view (`RadianceSettle.frozen`) builds
 *  none: its reflections keep reading the lit image they froze on, so the images after it are drawn
 *  from inputs that no longer move — its history, its pyramid, its view — and repeat, bit for bit,
 *  whatever share of the lit image their own reflections are. */
export function encodeImageRadiance(
  encoder: GPUCommandEncoder,
  reflection: ScreenReflection,
  stages: RadianceStages,
  inputs: RadianceInputs,
  frame: ReflectionFrame,
) {
  if (reflection.settle.frozen) return reflection.settle.image(encoder, false)
  const pass = encoder.beginComputePass({ label: REFLECTION_RADIANCE_PASS })
  encodeRadiancePyramid(
    pass,
    reflection.device,
    reflection.radiance,
    stages,
    inputs,
    frame.size,
    frame.viewProjection,
    frame.pose ?? frame.viewProjection,
    !!frame.still,
    reflection.settle.verified,
  )
  pass.end()
  reflection.settle.image(encoder, reflection.radiance.hashed)
}
