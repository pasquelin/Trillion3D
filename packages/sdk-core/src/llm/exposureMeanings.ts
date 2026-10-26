import type { ExposureField } from '../contracts/exposureOptions.ts'

/** What each setting of the exposure means (`../contracts/exposureOptions.ts`); the first twelve,
 *  and the method's, apply where the exposure is 'auto', the default, which measures each image on
 *  the GPU (the camera's, for the manual method), the pre-exposure's and the local exposure's to a
 *  lit view whatever its exposure. */
export const EXPOSURE_MEANINGS: Readonly<Record<ExposureField, string>> = {
  exposureBias:
    'Stops added to the target of the automatic exposure: the mean of the image lands at 0.18 times two to the bias, before the display curve.',
  exposureMinBrightness:
    'Lowest mean luminance the automatic exposure follows, in EV100 (a stop is a doubling of luminance, EV100 0 a luminance of 1). The same value as exposureMaxBrightness fixes the exposure.',
  exposureMaxBrightness: 'Highest mean luminance the automatic exposure follows, in EV100.',
  exposureHistogramLogMin:
    "Lowest stop of luminance the exposure's histogram spans; read no higher than one stop under exposureHistogramLogMax. A pixel under it counts in the lowest bucket.",
  exposureHistogramLogMax:
    "Highest stop of luminance the exposure's histogram spans; a pixel over it counts in the highest bucket.",
  exposureLowPercent:
    'Share of the pixels, darkest first, in percent from 1 to 99, left out of the mean; read no higher than exposureHighPercent.',
  exposureHighPercent:
    'Share of the pixels, darkest first, in percent from 1 to 99, past which the brightest are left out of the mean.',
  exposureSpeedUp:
    "Stops a second of the world's time the automatic exposure moves when the view brightens; 0 holds it. A camera cut jumps to the target.",
  exposureSpeedDown:
    "Stops a second of the world's time the automatic exposure moves when the view darkens; 0 holds it.",
  exposureTransitionDistance:
    'Distance in stops from its target inside which the automatic exposure slows from its linear speed to an exponential approach.',
  exposureBlackBucketWeight:
    "How much the darkest bucket of the exposure's histogram, the pixels of no light, counts: 0 ignores them, 1 counts them as any pixel.",
  exposureLuminanceMethod:
    "How a pixel's luminance is read for the histogram: 'uniform' the mean of its three channels, 'ntsc' the legacy video weights, 'workingSpace' the weights of the sRGB primaries.",
  exposureMethod:
    "How the automatic exposure is found: 'histogram' the mean between two percentiles of the image's histogram of log luminance, 'basic' the weighted mean of its log luminance over a coarse grid of the image, a sixty-fourth of its size on each axis, a cheaper measure that the metering mask weighs, 'manual' no measure: the exposure is the camera's, from its settings and the bias.",
  exposureApplyPhysicalCamera:
    "Where the method is 'manual': true takes the exposure from the camera's aperture (the depth of field's, f/4 where there is none), exposureCameraShutterSpeed and exposureCameraIso, EV100 = log2(aperture squared times shutter speed times 100 over ISO); false reads the camera as EV100 0, the bias alone setting the exposure.",
  exposureCameraShutterSpeed:
    "The camera's shutter speed in 1/s, from 0.01 to 8000, which the 'manual' method's physical camera reads: 60 is a sixtieth of a second.",
  exposureCameraIso:
    "The camera sensor's sensitivity, 1 or more, which the 'manual' method's physical camera reads.",
  exposureLensAttenuation:
    "The camera lens' attenuation, 0.01 or more: 0.78 makes lighting unitless (a luminance of 1 is EV100 0, the exposure's EV100s being read from 0.78 over this number times a luminance of 1); a lower one raises the luminance the EV100s are read from.",
  preExposure:
    'Whether every light is written to the image already multiplied by the exposure of the image before, and the composition divides it back out: the picture is the same, the half floats keep their range at any exposure, and the histories (temporal pass, fog volume, clouds, reflections) are brought to the new number by the ratio of the two. false writes every light as it is.',
  preExposureOverride:
    'When above 0, the pre-exposure every light is multiplied by, in place of the exposure of the image before; 0 keeps that exposure. Only read where preExposure is true.',
  cachedLightingPreExposure:
    "Stops, from -16 to 16: the lighting kept from one image to the next (the sky light's real-time capture) is written multiplied by 2 to the minus this number and read multiplied by its inverse, so the half floats it is stored in neither clip nor lose precision over the exposure range: 4 covers about -8 to +12 stops of exposure, 8 about -4 to +16. Read whether preExposure is on or off.",
  localExposureHighlightContrast:
    'Scale of the smooth light of the neighbourhood above middle grey, from 0 up: under 1 the highlights come down, 1 leaves them; 0.8 by default, which turns the local exposure on; 1 for both contrasts with a detail strength of 1 turns it off.',
  localExposureShadowContrast:
    'Scale of the smooth light of the neighbourhood under middle grey, from 0 up: under 1 the shadows come up, 1 leaves them; 0.8 by default.',
  localExposureDetailStrength:
    'Scale of what each pixel adds to the light around it, from 0 up: 1 keeps the detail as it is, 0 flattens it.',
  localExposureBlurBlend:
    'Share of the base layer taken from a wide blur of the luminance, from 0 to 1; the rest comes from the bilateral grid, which follows edges but rings at them.',
  localExposureBlurSize:
    "Width of the luminance blur, in percent of the image, read at 1/32 of the image's size.",
  localExposureMiddleGreyBias:
    'Stops added to the middle grey the base layer is pulled toward; an automatic exposure already moves it by exposureBias.',
  localExposureHighlightThreshold:
    'Distance in stops above middle grey inside which the base layer keeps its own contrast, from 0 up.',
  localExposureShadowThreshold:
    'Distance in stops under middle grey inside which the base layer keeps its own contrast, from 0 up.',
  localExposureHighlightThresholdStrength:
    'How sharply the highlight contrast takes over past its threshold, from 0 to 1: 1 the sharpest.',
  localExposureShadowThresholdStrength:
    'How sharply the shadow contrast takes over past its threshold, from 0 to 1: 1 the sharpest.',
}
