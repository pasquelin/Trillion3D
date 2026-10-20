import type { Engine } from '../../engine/types.ts'
import type { RenderScale } from '../../frame/renderScaleOption.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'

type Inputs = { check: () => void; engine: Engine }

/** The engine's render switches, written in place at the next frame, no session reopened:
 *  temporal antialiasing and the render scale. */
export function createExplorerRenderApi({ check, engine }: Inputs) {
  return {
    /** Temporal antialiasing's level at the next frame, `'off'` none, no session reopened. */
    setTemporalAntialiasing(level: TemporalAntialiasingLevel) {
      check()
      engine.setTemporalAntialiasing(level)
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
