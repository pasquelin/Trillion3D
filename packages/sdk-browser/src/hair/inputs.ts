import type { EngineCamera } from '../camera/engineCamera.ts'
import type { HairDeepShadowLight, HairDeepShadowSettings } from './deepShadowMath.ts'
import type { HairLutSettings } from './hairLutPass.ts'
import type { HairRasterSettings } from './rasterModes.ts'
import type { HairShadowInputs } from './shadowCasters.ts'

/** What the passes read of the camera. */
type HairCamera = Pick<
  EngineCamera,
  'view' | 'projection' | 'near' | 'eye' | 'viewRelative' | 'planes' | 'perspective'
>

/** How the strands integrate the environment's light: by the spherical harmonics of the sky (`sh`, the default), by a few directions weighed by the fibre (`adhoc`) or
 *  by directions spread evenly over the sphere (`uniform`), the last two traced through the voxels; the directions a point casts, how far (metres), and whether the screen
 *  occludes the directions. */
export interface HairSkyLightingSettings {
  readonly integration: 'sh' | 'adhoc' | 'uniform'
  readonly sampleCount: number
  readonly distanceThreshold: number
  readonly screenTrace: boolean
}

/** The settings of the voxel volume the strands are summed into (`hairVoxel*`), lengths in metres. */
export interface HairVoxelSettings {
  /** The width of the smallest voxel. */
  readonly worldSize: number
  /** Voxels a page spans a side (a power of two) and pages the volume spans a side. */
  readonly pageResolution: number
  readonly pageCountPerDim: number
  /** The scale of a macro group's box in the estimate of the page index it needs. */
  readonly aabbScale: number
  /** The voxel width follows the pages the view needs, at a speed and with a margin. */
  readonly adaptive: boolean
  /** The page index is found and allocated on the GPU (else by the CPU), and a page the levels find empty
   *  leaves the page index. */
  readonly gpuDriven: boolean
  readonly invalidateEmptyPageIndex: boolean
  /** What the transmittance through the volume reads: its densities, depth bias and stepping (the settings
   *  of the shadow's own where the transmittance names none), how its rays are jittered (0 none, 1 each
   *  frame, 2 constant), whether it takes 8 rays and marches through the levels. */
  readonly densityScaleTransmittance: number
  readonly depthBiasScaleTransmittance: number
  readonly steppingScaleTransmittance: number
  readonly jitterMode: number
  readonly superSampling: boolean
  readonly mipTraversal: boolean
  /** What the occlusion and the environment's rays read: the density the strands give a voxel for the occlusion, the stepping of the march and the
   *  start of the rays moved along them in voxels (`hairVoxelDensityScaleAO`, `hairVoxelSteppingScaleEnvironment`, `hairVoxelDepthBiasScaleEnvironment`). */
  readonly densityScaleAO: number
  readonly steppingScaleEnvironment: number
  readonly depthBiasScaleEnvironment: number
  readonly densityScaleEnvironment: number
  /** What the rays traced through the scene's triangles read (`hairVoxelDensityScaleRaytracing`, `hairVoxelSteppingScaleRaytracing`). */
  readonly densityScaleRaytracing: number
  readonly steppingScaleRaytracing: number
  /** What the shadow the strands cast on the surfaces reads of the volume (`hairVoxelDensityScaleShadow`, `hairVoxelDepthBiasScaleShadow`, `hairVoxelSteppingScaleShadow`). */
  readonly densityScaleShadow: number
  readonly depthBiasScaleShadow: number
  readonly steppingScaleShadow: number
  readonly correctionSpeed: number
  readonly correctionThreshold: number
  /** The least and the greatest page index kept, entries a side. */
  readonly minPageIndexResolution: number
  readonly maxPageIndexResolution: number
  /** The opaque surface is written into the volume, `biasCount` voxels in front and `markCount` deep. */
  readonly injectOpaqueDepth: boolean
  readonly biasCount: number
  readonly markCount: number
}

/**
 * EVERYTHING AN IMAGE OF THE STRANDS READS OF THE FRAME, in one record: the frame hook
 * (`frame.ts`) is the one place that reads the runtime and fills it, and the passes take it as it is,
 * as the GPU proof does from a camera of its own. The sizes are in pixels; the settings are those of
 * `hairStrandsOptions.ts`, read once.
 */
export interface HairFrameInputs {
  readonly camera: HairCamera
  /** The image drawn, and the size the render targets were made at (the depth's, which the passes
   *  that draw into it share). */
  readonly size: readonly [number, number]
  readonly allocated: readonly [number, number]
  /** The opaque depth of the image, none while the targets are not made. */
  readonly depthView: GPUTextureView | undefined
  /** The view-projection of the image with its temporal jitter, the eye at the origin, column-major. */
  readonly viewProjection: ArrayLike<number>
  /** The inverse of `viewProjection`. */
  readonly inverseViewProjection: ArrayLike<number>
  /** The direction the camera faces. */
  readonly forward: ArrayLike<number>
  /** The size a pixel's width at a distance of 1 is measured in: the image's, or the display's where
   *  the strands do not follow the resolution scale. */
  readonly pixelSize: readonly [number, number]
  /** The lights that draw a deep shadow and the settings of the shadows; none while no light does, or the
   *  transmittance and the shadow come from the voxels alone. */
  readonly deepShadow?: {
    readonly settings: HairDeepShadowSettings
    readonly lights: readonly HairDeepShadowLight[]
  }
  /** The table of the fibre's scattering the strands are lit with (`hairLut*`) and the components of the BSDF
   *  (`HAIR_COMPONENT` bits, `hairComponent*`); none for the frame hook of a proof, which lights nothing. */
  readonly lut?: HairLutSettings
  readonly components?: number
  /** The filter of the shadow the strands cast on the surfaces and how its voxel rays are jittered (`hairDeepShadowMaskKernelType`, `hairDeepShadowRandomType`). */
  readonly surfaceShadow?: { readonly kernelType: number; readonly randomType: number }
  /** How the strands take the environment's light (`hairEnvironmentIntegration`, `hairSkyLighting*`); none for the frame hook of a proof, which lights nothing. */
  readonly sky?: HairSkyLightingSettings
  /** Whether the samples that scatter the scene's light take it from the lit image (`hairScatterSceneLighting`). */
  readonly scatterSceneLighting?: boolean
  /** The voxel volume's settings, none while the strands are not voxelized. */
  readonly voxel?: HairVoxelSettings
  /** The voxel settings the macro groups' bounds read. */
  readonly sizeInPixel: number
  readonly pageResolution: number
  /** The scales of the least width of a strand: the primary one, and the stable one for a groom drawn
   *  stable (`hairRasterizationScale`, `hairStableRasterizationScale`). */
  readonly rasterizationScale: number
  readonly stableRasterizationScale: number
  /** The `HAIR_FLAG` bits of every strand, from the settings. */
  readonly flags: number
  /** The visibility settings. */
  readonly samplesPerPixel: number
  readonly meanSamplesPerPixel: number
  readonly sortByDepth: boolean
  /** Whether the device's rasterizer writes the samples (`hairVisibilityComputeRaster` off, the default);
   *  none or false, a compute raster does. */
  readonly hardwareRaster?: boolean
  /** Whether the forward raster draws the strands (`hairVisibilityComputeRasterForward`): their control points are lit and a tiled compute raster shades the segments between them into the image; none or false, the visibility buffer does. */
  readonly forwardRaster?: boolean
  /** Whether the coverage of the pixels comes from the count of the strands (`hairVisibilityCoverageMapping`). */
  readonly coverageMapping?: boolean
  /** The compute raster's settings (`hairVisibilityNaiveRaster`, `hairVisibilityTileCompaction`, `hairVisibilityClassification` and the sizes of its passes); the reference's where none (a proof's), filled in place each image. */
  readonly raster?: HairRasterSettings
  /** The coverage from which a pixel writes the custom depth (`hairCustomDepthCoverageThreshold`), none while the strands render none (`hairRenderCustomDepth`). */
  readonly customDepthCoverage?: number
  /** The curve raster pipeline's settings (`renderCurve` with `renderCurveSwRaster`, `renderCurveRasterNumBinners`, `renderCurveRasterNumRasterizers`, `renderCurveRasterMinCoverage`), none while it is off. */
  readonly renderCurve?: {
    readonly binners: number
    readonly rasterizers: number
    readonly minCoverage: number
  }
  readonly fullCoverage: number
  /** The surfaces' colours and words, which the strands that cover a pixel wholly empty (their storage
   *  views, `SurfaceBuffer.stores`), and the layer of the colours that holds the emission (0 for
   *  none); none where they are not handed (the frame hands none while nothing lights the strands). */
  readonly surfaces: readonly [GPUTextureView, GPUTextureView] | undefined
  readonly emissionLayer: number
  /** The lights that reach the grooms out of view; none when those grooms do not cast. */
  readonly shadow: HairShadowInputs | undefined
}

/** `inputs` as the frame hook refills it, in place, each image. */
export type HairFrameInputsWritable = { -readonly [K in keyof HairFrameInputs]: HairFrameInputs[K] }
