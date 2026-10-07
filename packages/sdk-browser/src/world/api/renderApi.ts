import type { Engine } from '../../engine/types.ts'
import type { RenderScale } from '../../frame/renderScaleOption.ts'
import { TAA_CAPABILITY } from '../../taa/capability.ts'

type Inputs = { check: () => void; engine: Engine }

/** The engine's render switches, written in place at the next frame, no session reopened:
 *  temporal antialiasing and the render scale, with what the image carries of them. */
export function createExplorerRenderApi({ check, engine }: Inputs) {
  return {
    /** Temporal antialiasing on or off at the next frame, no session
     *  reopened. */
    setTemporalAntialiasing(on: boolean) {
      check()
      engine.setTemporalAntialiasing(on)
    },
    /** Whether the engine's image carries temporal antialiasing now: false switched off,
     *  refused by the device or while its program compiles. */
    temporalAntialiasing() {
      check()
      return !engine.capabilities.unsupported.includes(TAA_CAPABILITY)
    },
    /** The engine's render scale from the next frame. */
    setRenderScale(scale: RenderScale) {
      check()
      engine.setRenderScale(scale)
    },
    /** The scale the engine drew its last image at. */
    renderScale() {
      check()
      return engine.renderScale()
    },
  }
}
