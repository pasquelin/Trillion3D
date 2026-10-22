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
      mipChain(stage, encoder, t)
      filter(stage, encoder, t, state.ready, 0, t.mips - 1, 0, CUBE_FACES)
      harmonics(stage, encoder, t, state.ready)
      break
    case 'sky':
      faces.draw(encoder, t, step.faceFirst, step.faceEnd, true, false, input)
      break
    case 'clouds':
      faces.draw(encoder, t, step.faceFirst, step.faceEnd, false, true, input)
      break
    case 'mips':
      mipChain(stage, encoder, t)
      break
    case 'filter':
      filter(
        stage,
        encoder,
        t,
        workIndex(state),
        step.mipFirst,
        step.mipLast,
        step.faceFirst,
        step.faceCount,
      )
      break
    case 'harmonics':
      harmonics(stage, encoder, t, workIndex(state))
      break
    case 'nothing':
      break
  }
}
