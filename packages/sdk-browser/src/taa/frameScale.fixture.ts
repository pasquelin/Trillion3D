// A view under a dynamic render scale, entered image by image as the engine does, for the scale
// tests of the temporal pass (`frameScale.test.ts`).
import { IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'
import { beginTaaFrame } from './frame.ts'
import { type RenderScale } from '../frame/renderScaleOption.ts'
import { createTaaFrameState } from './frameState.ts'
import { createScaleControl } from '../frame/scaleControl.ts'
import { lowered } from '../frame/scaleFit.fixture.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'

export const DISPLAY = [3456, 2234]
const clock = { now: 0, frame: 0 }
/** A view drawn under the bounds {0.5; 1}, its controller dropped to about 0.6 by a 20 ms frame
 *  at 120 Hz; or under `option`, on `display`. */
export function runtime(option: RenderScale = { min: 0.5, max: 1 }, display = DISPLAY) {
  const scale = createScaleControl(option),
    revisions = { scene: 0, view: 0, resources: 0 }
  lowered(scale, 20, clock)
  const rt = {
    gpu: {
      temporal: { frame: createTaaFrameState() },
      temporalWanted: true,
      temporalLevel: 'max',
      targetSize: [...display],
      allocatedSize: [...display],
      displaySize: display,
      colorTexture: {},
      displayTexture: {},
    },
    vis: {},
    views: { active: { scale } },
    run: {
      diagnostic: 'beauty',
      frame: 0,
      textureConverging: false,
      gate: { temporalRevision: 0, revisions, resourcesChanged: () => void revisions.resources++ },
    },
    capture: { capturing: false },
    lights: {},
  } as unknown as WebgpuPagesRuntime
  return { rt, moving: scale.wanted() }
}

const cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera
/** An image entry on `rt`: a moving one moves the view first; the first image of a view moves. */
export const enter = (rt: WebgpuPagesRuntime, quiet: boolean) => {
  if (!quiet) rt.run.gate.revisions.view++
  beginTaaFrame(rt, cam)
}
