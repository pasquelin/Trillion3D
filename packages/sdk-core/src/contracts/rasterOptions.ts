import {
  flagSetting as flag,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the cluster rasterization: which rasterizer takes each cluster of the
 * cut (`packages/sdk-browser/src/visibility/raster/binWgsl.ts`). They are the engine's own,
 * applied from the next frame: no compiler job names them, so no manifest carries them and no
 * cache key holds them. Neither has quality levels: the scalability groups of the reference leave
 * both at their defaults, so a quality preset writes neither (`../runtime/qualityLevels.ts`). Each
 * is a world option (`WorldOptions`), `world.softwareRaster` and `world.hardwareRasterEdgePixels`,
 * a session option, a render setting of the view distance's group
 * (`packages/sdk-browser/src/session/world/settings.ts`), and the LLM schemas name it by its field
 * and say what it means (`../llm/settingProperties.ts`). Each is read by the one resolver of the
 * rules (`resolveSetting`, `./settingRules.ts`), whoever takes it — the world, a session, the
 * frame.
 */

/** The software raster's default: on, the reference's own. */
const DEFAULT_SOFTWARE_RASTER = true
/** The hardware raster edge's default, 32 pixels: the reference's own. */
export const DEFAULT_HARDWARE_RASTER_EDGE_PIXELS = 32

/** The raster's settings by field: `softwareRaster`, on, a cluster whose longest edge projects
 *  under `hardwareRasterEdgePixels` and whose box crosses neither clip plane is rastered in
 *  compute, every other one by the hardware rasterizer — off, the hardware rasterizer draws every
 *  cluster —, and `hardwareRasterEdgePixels`, the projected edge, in pixels, from which a
 *  cluster, seen at the nearest point of its level-of-detail sphere, goes to the hardware
 *  rasterizer: a finite number above zero. */
export const RASTER_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('softwareRaster', DEFAULT_SOFTWARE_RASTER),
    positive(
      'hardwareRasterEdgePixels',
      DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
      'a finite number of pixels above zero',
    ),
  ] as const))()
/** The field of one raster setting. */
export type RasterField = keyof typeof RASTER_RULES
/** The raster's settings as a host writes them: each its value, or nothing for its default. */
export type RasterOptions = SettingOptions<typeof RASTER_RULES>
