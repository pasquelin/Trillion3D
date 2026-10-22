import {
  flagSetting as flag,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the cluster rasterization: which rasterizer takes each cluster of the
 * cut (`packages/sdk-browser/src/visibility/raster/binWgsl.ts`), the world options
 * `world.softwareRaster` and `world.hardwareRasterEdgePixels`, applied from the next frame.
 * Run-time settings, as `./settingRules.ts` says.
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
