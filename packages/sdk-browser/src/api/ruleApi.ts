import type { EngineContext } from '../session/engine/types.ts'
import { ANIMATION_RULES } from '../../../sdk-core/src/contracts/animationOptions.ts'
import { CUT_RULES } from '../../../sdk-core/src/contracts/cutOptions.ts'
import { RASTER_RULES } from '../../../sdk-core/src/contracts/rasterOptions.ts'
import { settingWriter } from '../../../sdk-core/src/contracts/settingRules.ts'
import { SHADING_RULES } from '../../../sdk-core/src/contracts/shadingOptions.ts'
import { STREAMING_RULES } from '../../../sdk-core/src/contracts/streamingOptions.ts'
import { WORLD_STREAMING_RULES } from '../../../sdk-core/src/contracts/worldStreamingOptions.ts'

type Inputs = { check: () => void; context: EngineContext }

/**
 * The run-time settings a session holds in its context, written in place by their field and read
 * from the next frame — the next update for the streaming's — (each family's rules,
 * `../../../sdk-core/src/contracts/`): `undefined` or `null` gives back a setting's default, a
 * value it does not take is refused by its one resolver, naming the field and the values it
 * takes. The cut's, the animation's and the shading's, the partition's streaming and the HLOD
 * warm-up's, the geometry streaming's, and the cluster raster's split.
 */
export function createExplorerRuleApi({ check, context }: Inputs) {
  const raster = settingWriter(RASTER_RULES, context, check)
  return {
    /** Writes the cut's setting `field` (`cutOptions.ts`). */
    setCut: settingWriter(CUT_RULES, context, check),
    /** Writes the animation's setting `field` (`animationOptions.ts`): the screen size under which
     *  an instanced skinned object is drawn in its rest pose and how the scene's animation banks
     *  play their tracks. */
    setAnimation: settingWriter(ANIMATION_RULES, context, check),
    /** Writes the shading's setting `field` (`shadingOptions.ts`): how the shading bins hold each
     *  material class's pixels. */
    setShading: settingWriter(SHADING_RULES, context, check),
    /** Writes the setting `field` of how the view streams a partitioned scene's cells and of the
     *  warm-up an HLOD switch waits on (`worldStreamingOptions.ts`). */
    setWorldStreaming: settingWriter(WORLD_STREAMING_RULES, context, check),
    /** Writes the geometry streaming's setting `field` (`streamingOptions.ts`), from the
     *  streaming's next update. */
    setStreaming: settingWriter(STREAMING_RULES, context, check),
    /** The software raster from the next frame (`softwareRaster`, `rasterOptions.ts`): `false`
     *  hands every cluster to the hardware rasterizer. */
    setSoftwareRaster: (on: boolean) => raster('softwareRaster', on),
    /** The projected edge in pixels from which a cluster goes to the hardware rasterizer, from the
     *  next frame (`hardwareRasterEdgePixels`, `rasterOptions.ts`). */
    setHardwareRasterEdgePixels: (pixels: number) => raster('hardwareRasterEdgePixels', pixels),
  }
}
