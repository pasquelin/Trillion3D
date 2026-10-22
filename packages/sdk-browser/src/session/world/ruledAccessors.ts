import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { CutOptions } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import type { DynamicResolutionOptions } from '../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import type { AnimationOptions } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import type { ShadingOptions } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import type { ExposureOptions } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { TemporalOptions } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { HizOptions } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import type { LightFunctionOptions } from '../../../../sdk-core/src/contracts/lightFunctionOptions.ts'
import type { VolumetricLightmapOptions } from '../../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import type { GlobalDistanceFieldOptions } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import type { DistanceFieldOcclusionOptions } from '../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import type { worldFamilies } from './ruledSwitches.ts'

type Families = ReturnType<typeof worldFamilies>

/** The software raster's two settings and the rasterizer's and geometry streaming's families by
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

/** The other families by rule: read, their settings resolved over the page and the preset, by
 *  field; written, the page's settings the options name (`ruledSwitches`). */
export function ruledAccessors(families: Families) {
  return {
    get worldStreaming() {
      return families.worldStreaming.values()
    },
    set worldStreaming(options: WorldStreamingOptions & HlodWarmupOptions) {
      families.worldStreaming.set(options)
    },
    get cut() {
      return families.cut.values()
    },
    set cut(options: CutOptions) {
      families.cut.set(options)
    },
    get dynamicResolution() {
      return families.dynamicResolution.values()
    },
    set dynamicResolution(options: DynamicResolutionOptions) {
      families.dynamicResolution.set(options)
    },
    get animation() {
      return families.animation.values()
    },
    set animation(options: AnimationOptions) {
      families.animation.set(options)
    },
    get shading() {
      return families.shading.values()
    },
    set shading(options: ShadingOptions) {
      families.shading.set(options)
    },
    get exposureSettings() {
      return families.exposure.values()
    },
    set exposureSettings(options: ExposureOptions) {
      families.exposure.set(options)
    },
    get temporal() {
      return families.temporal.values()
    },
    set temporal(options: TemporalOptions) {
      families.temporal.set(options)
    },
    get hiz() {
      return families.hiz.values()
    },
    set hiz(options: HizOptions) {
      families.hiz.set(options)
    },
    get lightFunction() {
      return families.lightFunction.values()
    },
    set lightFunction(options: LightFunctionOptions) {
      families.lightFunction.set(options)
    },
    get volumetricLightmap() {
      return families.volumetricLightmap.values()
    },
    set volumetricLightmap(options: VolumetricLightmapOptions) {
      families.volumetricLightmap.set(options)
    },
    get globalDistanceField() {
      return families.globalDistanceField.values()
    },
    set globalDistanceField(options: GlobalDistanceFieldOptions) {
      families.globalDistanceField.set(options)
    },
    get distanceFieldOcclusion() {
      return families.distanceFieldOcclusion.values()
    },
    set distanceFieldOcclusion(options: DistanceFieldOcclusionOptions) {
      families.distanceFieldOcclusion.set(options)
    },
  }
}
