import type { createFaceDrawer } from './captureFaces.ts'
import { filter, harmonics, mipChain, type FilterStage } from './captureFilter.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import { CUBE_FACES } from './layout.ts'
import { advanceCapture, workIndex, type CaptureState } from './schedule.ts'
import type { SkyLightTargets } from './targets.ts'

/** This frame's step of the real-time capture, on the steps `schedule.ts` says: all at once, or one
 *  slice of the sky, the clouds, the mips, the filter or the harmonics. */
export function encodeRealTime(
  stage: FilterStage,
  faces: ReturnType<typeof createFaceDrawer>,
  state: CaptureState,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  input: SkyLightInputs,
) {
  const { quality } = input.part
  const step = advanceCapture(state, {
    timeSlice: quality.skyLightTimeSlicing,
    facesPerFrame: quality.skyLightFacesPerFrame,
    mips: t.mips,
  })
  switch (step.kind) {
    case 'whole':
      faces.draw(encoder, t, 0, CUBE_FACES, true, true, input)
      stage.steps.begin(encoder)
      mipChain(stage, t)
      filter(stage, t, state.ready, 0, t.mips - 1, 0, CUBE_FACES)
      harmonics(stage, t, state.ready)
      stage.steps.end()
      break
    case 'sky':
      faces.draw(encoder, t, step.faceFirst, step.faceEnd, true, false, input)
      break
    case 'clouds':
      faces.draw(encoder, t, step.faceFirst, step.faceEnd, false, true, input)
      break
    case 'mips':
      stage.steps.begin(encoder)
      mipChain(stage, t)
      stage.steps.end()
      break
    case 'filter':
      stage.steps.begin(encoder)
      filter(
        stage,
        t,
        workIndex(state),
        step.mipFirst,
        step.mipLast,
        step.faceFirst,
        step.faceCount,
      )
      stage.steps.end()
      break
    case 'harmonics':
      stage.steps.begin(encoder)
      harmonics(stage, t, workIndex(state))
      stage.steps.end()
      break
    case 'nothing':
      break
  }
}
