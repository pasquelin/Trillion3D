import type { Engine } from '../../engine/types.ts'
import type { RenderScale } from '../../frame/renderScaleOption.ts'
import { TAA_CAPABILITY } from '../../taa/capability.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'

type Inputs = { check: () => void; engine: Engine }

/** The engine's render switches, written in place at the next frame, no session reopened:
 *  temporal antialiasing and the render scale, with what the image carries of them. */
export function createExplorerRenderApi({ check, engine }: Inputs) {
  return {
    /** Temporal antialiasing's level at the next frame, `'off'` none, no session reopened. */
    setTemporalAntialiasing(level: TemporalAntialiasingLevel) {
      check()
      engine.setTemporalAntialiasing(level)
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
    /** The engine loop's frame cap from the next frame (`EngineContext.maxFrameRate`). */
    setMaxFrameRate(rate: number) {
      check()
      engine.setMaxFrameRate(rate)
    },
    /** The scale the engine drew its last image at. */
    renderScale() {
      check()
      return engine.renderScale()
    },
  }
}
