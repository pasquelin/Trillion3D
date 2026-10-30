import {
  ANY_NUMBER,
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
} from '../../contracts/settingRules.ts'
import { INT32, INT32_FROM_ZERO } from './qualityRanges.ts'

/** The light shafts' settings by field: `lightShafts` (on), whether the sun and the lamps that ask
 *  for them draw shafts through the air and the clouds' edges, and `lightShaftDownsample` (2), from
 *  1 to 8: the factor the shafts are computed at under the view's size;
 *  `lightShaftTemporalFilter` (on): the shafts are filtered over the images;
 *  `lightShaftBlurPasses` (3), a whole number from 0: the radial blur passes;
 *  `lightShaftFirstPassDistance` (0.1): the fraction of the distance to the light the first pass
 *  blurs over. */
export const IMAGE_EFFECTS_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('lightShafts', true),
    integer('lightShaftDownsample', 2, [1, 8]),
    flag('lightShaftTemporalFilter', true),
    integer('lightShaftBlurPasses', 3, INT32_FROM_ZERO),
    number('lightShaftFirstPassDistance', 0.1, ANY_NUMBER),
  ] as const))()

/** The sky light's settings by field: `skyLightRealTimeCapture` (on), whether the platform allows
 *  the sky light's real-time capture at all; `skyLightTimeSlicing` (on), whether the sky light's capture
 *  and its convolutions are spread over several images; `skyLightFacesPerFrame` (2), from 1 to 6:
 *  the cube faces the clouds are drawn in per image when it is, more being a lag fewer;
 *  `skyLightCloudDivider` (2), from 1 to 8: the factor the clouds' size is divided by in that capture;
 *  `skyLightIntensityScale` (1): the factor on the sky light's intensity, to keep the
 *  contrast of a level that draws less occlusion; `skyLightShadowFromOpaque` (off): opaque meshes
 *  shadow the sky and the clouds from the sun in the capture;
 *  `skyLightAlwaysClear` (off): the capture's colour is cleared to black before the sky is drawn;
 *  `skyLightDepthBuffer` (on): the capture's sky meshes are drawn with a depth buffer, so that they cover each other correctly and the
 *  height fog is laid at their distance, not along an endless ray;
 *  `skyLightResolutionOverride` (0): a side, in texels, of at least 16, that replaces the sky
 *  light's own in its real-time capture only, a lower value leaving it; `skyLightCubemapMaxResolution` (-1): above 0, the largest
 *  side the sky light's cube may have; `skyLightCaptureSupersample` (1), from 1 to 8: the factor
 *  the faces of a captured scene are drawn larger by than the cube's side, then averaged down;
 *  `skyLightCaptureLodDistanceScale` (1): the factor the detail of a captured scene is asked at,
 *  a value of zero or less being 1. */
export const INDIRECT_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('skyLightRealTimeCapture', true),
    flag('skyLightTimeSlicing', true),
    integer('skyLightFacesPerFrame', 2, [1, 6]),
    integer('skyLightCloudDivider', 2, [1, 8]),
    number('skyLightIntensityScale', 1, ANY_NUMBER),
    flag('skyLightShadowFromOpaque', false),
    flag('skyLightAlwaysClear', false),
    flag('skyLightDepthBuffer', true),
    integer('skyLightResolutionOverride', 0, INT32),
    integer('skyLightCubemapMaxResolution', -1, INT32),
    integer('skyLightCaptureSupersample', 1, [1, 8]),
    number('skyLightCaptureLodDistanceScale', 1, ANY_NUMBER),
  ] as const))()
