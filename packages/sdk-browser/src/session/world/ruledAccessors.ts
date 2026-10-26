import {
  memberOf,
  SETTING_FAMILIES,
  type FamilyTable,
} from '../../../../sdk-core/src/runtime/settingFamilies.ts'
import type { WorldFamilies } from './ruledSwitches.ts'
import type { WorldImageSettings } from './worldImageTypes.ts'
import type { WorldSceneSettings } from './worldSceneTypes.ts'

type Families = WorldFamilies

/** The cluster raster's five settings and the rasterizer's and geometry streaming's families by
 *  rule: read, their settings resolved over the page and the preset, by field — what a session
 *  opens with — (`ruledSwitches`). */
export function rasterAccessors(families: Families) {
  return {
    /** The software raster, resolved over the page and the preset. */
    get softwareRaster(): boolean {
      return families.raster.get('softwareRaster')
    },
    /** The page's software raster; `undefined` or `null` gives the setting back to the preset. */
    set softwareRaster(option: boolean | null | undefined) {
      families.raster.set({ softwareRaster: option })
    },
    /** The hardware raster edge in pixels, resolved over the page and the preset. */
    get hardwareRasterEdgePixels(): number {
      return families.raster.get('hardwareRasterEdgePixels')
    },
    /** The page's hardware raster edge; `undefined` or `null` gives the setting back to the
     *  preset. */
    set hardwareRasterEdgePixels(option: number | null | undefined) {
      families.raster.set({ hardwareRasterEdgePixels: option })
    },
    /** Whether the software raster's cutout clusters are ordered by depth bucket, resolved over the
     *  page and the preset. */
    get depthBucketing(): boolean {
      return families.raster.get('depthBucketing')
    },
    /** The page's depth bucketing; `undefined` or `null` gives the setting back to the preset. */
    set depthBucketing(option: boolean | null | undefined) {
      families.raster.set({ depthBucketing: option })
    },
    /** The depth in metres the buckets start at, resolved over the page and the preset. */
    get depthBucketsMinZ(): number {
      return families.raster.get('depthBucketsMinZ')
    },
    /** The page's first bucket depth; `undefined` or `null` gives the setting back to the preset. */
    set depthBucketsMinZ(option: number | null | undefined) {
      families.raster.set({ depthBucketsMinZ: option })
    },
    /** The depth in metres the buckets end at, resolved over the page and the preset. */
    get depthBucketsMaxZ(): number {
      return families.raster.get('depthBucketsMaxZ')
    },
    /** The page's last bucket depth; `undefined` or `null` gives the setting back to the preset. */
    set depthBucketsMaxZ(option: number | null | undefined) {
      families.raster.set({ depthBucketsMaxZ: option })
    },
    // Each family by rule: read, its settings resolved over the page and the preset, by field —
    // what a session opens with —; written, the page's settings the options name (`ruledSwitches`).
    get raster() {
      return families.raster.values()
    },
    get streaming() {
      return families.streaming.values()
    },
  }
}

/** The families by rule the world carries (`SETTING_FAMILIES`, each row's `world`): read, their
 *  settings resolved over the page and the preset, by field; written, the page's settings the
 *  options name (`ruledSwitches`). One accessor for each row of `table`, defined as an accessor and
 *  typed as the world's own (`WorldSceneSettings`, `WorldImageSettings`), whose documentation says
 *  what each family is. The raster and the geometry streaming are `rasterAccessors`'. */
export function ruledAccessors(
  families: Families,
  table: FamilyTable = SETTING_FAMILIES,
): WorldSceneSettings & WorldImageSettings {
  const byName = families as unknown as Record<
    string,
    { values(): unknown; set(options: unknown): void }
  >
  const accessors = {}
  for (const [name, family] of Object.entries(table)) {
    if (!family.world) continue
    Object.defineProperty(accessors, memberOf(name, table), {
      enumerable: true,
      configurable: true,
      get: () => byName[name].values(),
      set: (options: unknown) => byName[name].set(options),
    })
  }
  return accessors as WorldSceneSettings & WorldImageSettings
}
