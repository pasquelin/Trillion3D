import type { EngineCamera } from '../camera/engineCamera.ts'
import type { HairShadowInputs } from './shadowCasters.ts'

/** What the passes read of the camera. */
type HairCamera = Pick<
  EngineCamera,
  'view' | 'projection' | 'near' | 'eye' | 'viewRelative' | 'planes' | 'perspective'
>

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
