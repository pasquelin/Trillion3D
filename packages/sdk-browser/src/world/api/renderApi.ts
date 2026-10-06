import type { RenderBackend } from '../../backend/types.ts'
import type { RenderScale } from '../../frame/renderScaleOption.ts'
import { TAA_CAPABILITY } from '../../taa/capability.ts'

type Inputs = { check: () => void; active: () => RenderBackend }

/** The active engine's render switches, written in place at the next frame, no session reopened:
 *  temporal antialiasing and the render scale, with what the image carries of them. */
export function createExplorerRenderApi({ check, active: getActive }: Inputs) {
  return {
    /** Temporal antialiasing on or off in the active engine at the next frame, no session
     *  reopened; an engine without it (WebGL2) ignores it. */
    setTemporalAntialiasing(on: boolean) {
      check()
      getActive().setTemporalAntialiasing?.(on)
    },
    /** Whether the active engine's image carries temporal antialiasing now: false on an engine
     *  without it, switched off, refused by the device or while its program compiles. */
    temporalAntialiasing() {
      check()
      const active = getActive()
      return (
        !!active.setTemporalAntialiasing &&
        !active.capabilities.unsupported.includes(TAA_CAPABILITY)
      )
    },
    /** The render scale of the active engine from the next frame; an engine without one draws at
     *  the display's size and ignores it. */
    setRenderScale(scale: RenderScale) {
      check()
      getActive().setRenderScale?.(scale)
    },
    /** The scale the active engine drew its last image at: 1 on an engine without it. */
    renderScale() {
      check()
      return getActive().renderScale?.() ?? 1
    },
  }
}
