/** The distortion offset scale: the view normal's bend, times the projection terms, to a fraction
 *  of the screen small enough that a glass of ior 1.5 moves the scene by a few pixels. The refracting
 *  glass (`transmission/distortionWgsl.ts`) and the water (`water/waterVolumeWgsl.ts`) bend by it.
 *  The value is the reference distortion's own offset factor (`ComputeBufferUVDistortion`), applied
 *  as it does: times the view's display size and the field-of-view and aspect terms (`writeDistortionView`). */
export const DISTORTION_FUDGE = 0.00023
