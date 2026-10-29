import {
  contextReader,
  flagSetting as flag,
  integerSetting as integer,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the rectangle lights' source-texture atlas (`packages/sdk-browser/src/lighting/rectLightAtlas/`):
 * the textures the rectangle lights name (`SceneLight.sourceTexture`) are kept in one square atlas, a slot each, with a chain of
 * mip levels the lighting reads by the solid angle the light covers. Run-time settings, as `./settingRules.ts` says: no compiler
 * job names them, so no manifest carries them; each is read again at each image, and each default is the reference's.
 *
 * - `rectLightAtlasMaxResolution` (4096, from 64 to 16384): the most texels a side of the atlas; past it the textures are packed
 *   a mip level smaller until they fit;
 * - `rectLightAtlasDebug` (off): draws the atlas, its slots, the horizon lines of the packing and the free rectangles over the
 *   image (the diagnostic view `rect-light-atlas`), and reports its figures;
 * - `rectLightAtlasDebugMipLevel` (0, from 0 to 15): the mip level the debug view shows;
 * - `rectLightAtlasForceUpdate` (off): makes the atlas again at every image;
 * - `rectLightAtlasResetOnChange` (off): packs the atlas again from nothing each time a texture joins it;
 * - `rectLightAtlasClear` (off): clears the atlas each time it is made again or changed (with the reset on change);
 * - `rectLightAtlasDebugClear` (off): fills a new atlas with magenta before anything is written, to see the texels no slot covers;
 * - `rectLightAtlasFilterQuality` (0, 0 or 1): how the mip levels are filtered, 0 a box of 2 by 2 texels, 1 a Gaussian approximation;
 * - `rectLightAtlasMaxTextureRatio` (2, from 1 to 16): the most the width of a texture may exceed its height, or its height its
 *   width, before the short side is stretched to keep it;
 * - `rectLightAtlasFormat` (0, 0 or 1): 0 packs the atlas in 11, 11 and 10 bits (faster, may shift the hue; a device that cannot
 *   draw into that format keeps 16-bit floats), 1 keeps four 16-bit floats (more accurate, slower);
 * - `sampledLightsTexturedRectLights` (on): the sampled lights shade the rectangle lights that name a texture with it.
 */
export const RECT_LIGHT_ATLAS_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integer('rectLightAtlasMaxResolution', 4096, [64, 16384]),
    flag('rectLightAtlasDebug', false),
    integer('rectLightAtlasDebugMipLevel', 0, [0, 15]),
    flag('rectLightAtlasForceUpdate', false),
    flag('rectLightAtlasResetOnChange', false),
    flag('rectLightAtlasClear', false),
    flag('rectLightAtlasDebugClear', false),
    integer('rectLightAtlasFilterQuality', 0, [0, 1]),
    integer('rectLightAtlasMaxTextureRatio', 2, [1, 16]),
    integer('rectLightAtlasFormat', 0, [0, 1]),
    flag('sampledLightsTexturedRectLights', true),
  ] as const))()

/** The field of one setting of the rectangle lights' atlas. */
export type RectLightAtlasField = keyof typeof RECT_LIGHT_ATLAS_RULES
/** The atlas's settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type RectLightAtlasOptions = SettingOptions<typeof RECT_LIGHT_ATLAS_RULES>

/** Each frame's reading of one setting of the rectangle lights' atlas from a runtime's context. */
export const readRectLightAtlasSetting = /* @__PURE__ */ contextReader(RECT_LIGHT_ATLAS_RULES)
