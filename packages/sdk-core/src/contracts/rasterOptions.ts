import {
  flagSetting as flag,
  positiveSetting as positive,
  contextReader,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the cluster rasterization: which rasterizer takes each cluster of the
 * cut (`packages/sdk-browser/src/visibility/raster/splitWgsl.ts`) and the order the software
 * raster takes its cutout clusters in, the world options `world.softwareRaster`,
 * `world.hardwareRasterEdgePixels`, `world.depthBucketing`, `world.depthBucketsMinZ` and
 * `world.depthBucketsMaxZ`, applied from the next frame. Run-time settings, as `./settingRules.ts`
 * says.
 */

/** The software raster's default: on, the reference's own. */
const DEFAULT_SOFTWARE_RASTER = true
/** The hardware raster edge's default, 32 pixels: the reference's own. */
export const DEFAULT_HARDWARE_RASTER_EDGE_PIXELS = 32
/** The depth bucketing's default, on: the reference's own. */
const DEFAULT_DEPTH_BUCKETING = true
/** The depth the buckets start at and end at, in metres: the reference's own, which counts in
 *  centimetres (1000 and 100000). */
const DEFAULT_DEPTH_BUCKETS_MIN_Z = 10
const DEFAULT_DEPTH_BUCKETS_MAX_Z = 1000

/** The raster's settings by field: `softwareRaster`, on, a cluster whose longest edge projects
 *  under `hardwareRasterEdgePixels` and whose box crosses neither clip plane is rastered in
 *  compute, every other one by the hardware rasterizer — off, the hardware rasterizer draws every
 *  cluster —, and `hardwareRasterEdgePixels`, the projected edge, in pixels, from which a
 *  cluster, seen at the nearest point of its level-of-detail sphere, goes to the hardware
 *  rasterizer: a finite number above zero. `depthBucketing`, on, orders the software raster's
 *  cutout clusters nearest first by the view depth of their box — spread over 256 buckets by its
 *  logarithm between `depthBucketsMinZ` and `depthBucketsMaxZ`, in metres, finite numbers above
 *  zero — so that a hidden cutout pixel leaves before its texture is read; as the reference does,
 *  it orders only where the scene holds voxels. */
export const RASTER_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('softwareRaster', DEFAULT_SOFTWARE_RASTER),
    positive(
      'hardwareRasterEdgePixels',
      DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
      'a finite number of pixels above zero',
    ),
    flag('depthBucketing', DEFAULT_DEPTH_BUCKETING),
    positive(
      'depthBucketsMinZ',
      DEFAULT_DEPTH_BUCKETS_MIN_Z,
      'a finite number of metres above zero',
    ),
    positive(
      'depthBucketsMaxZ',
      DEFAULT_DEPTH_BUCKETS_MAX_Z,
      'a finite number of metres above zero',
    ),
  ] as const))()
/** The raster setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readRasterSetting = /* @__PURE__ */ contextReader(RASTER_RULES)
/** The field of one raster setting. */
export type RasterField = keyof typeof RASTER_RULES
/** The raster's settings as a host writes them: each its value, or nothing for its default. */
export type RasterOptions = SettingOptions<typeof RASTER_RULES>
