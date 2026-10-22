import {
  ANY_NUMBER as ANY,
  integerSetting,
  flagSetting as flag,
  numberSetting as number,
  positiveSetting as positive,
  rulesOf,
  type SettingValues,
  vectorSetting as vector,
} from '../../contracts/settingRules.ts'

/**
 * The settings of the cloud material, the one the layer draws its clouds with: where its coverage
 * and its shape come from, how dense, how bright and how it scatters. Each has the reference
 * material's default. Vectors are written in the order their words list; a colour is linear.
 *
 * LAYOUT, over a tile of `layoutRepeatKm` kilometres the layout textures repeat across:
 * - `placement` (0, 0, 0, 0): the shift of the layout, in tiles, then its turn about the vertical,
 *   in radians;
 * - `typeWeights` (1, 1, 1, 2): how visible each cloud type is, the fourth the storm's;
 * - `typePatternScale` (1, 1, 1, 1): the scale of the pattern texture read for each type;
 * - `maskTypeWeights` (0, 0, 0, 1): how strongly the mask texture adds to or removes from each
 *   type, then the strength of the effect overall, in hundredths of a density;
 * - `coverageBias` (-0.2): added to the erosion, positive for more cloud;
 * - `wind` (1, 1, 0.5, 0.333333): the drift along each axis, then a scale of all three.
 *
 * SHAPE. The three noises read the noise volume at `scale x, y, z` tiles to the cycle, then how
 * far the wind carries them:
 * - `erosionNoise` (4.167, 4.444, 9.091, 7): the main breakup;
 * - `distortionNoise` (60, 60, 75, -6): the noise that bends the erosion's coordinates;
 * - `detailNoise` (30, 40, 25, 8) and `detailNoiseMultiplier` (0, 0, 1, 0.4): a third, finer
 *   noise, and the share of each volume channel that modulates the cloud, then its strength —
 *   read only with `thirdNoise` on;
 * - `noiseBias` (0.5, 0.8, 0.5): taken from the erosion, the distortion and the detail sample;
 * - `noiseStrength` (0.8, 0.08, 0.03, 2.5): what multiplies the biased samples, the fourth the
 *   storm's scale of the distortion;
 * - `densityPerMetre` (0.008): the extinction a unit of density gives, per metre.
 *
 * LOOK: `albedo` (0.98 grey) and `ambientOcclusion` (0.5), how much of the sky light the cloud
 * keeps.
 *
 * STORM, a blend `stormAmount` (0) from the plain clouds to storm clouds: `stormAlbedo` and
 * `stormOcclusionFactor` (0.333333), the lightning's `lightningTextureScale` (6),
 * `lightningColor` (2, 1.8, 2, brightness 10), `lightningSource` (power 6, fill scatter 0.05, fill
 * intensity 0.175, second mip 2.5), `lightningMasks` (bias 10, strength 5, cloud weight 0.5, 1) and
 * `lightningAnimation` (flicker 0, flash rate 0.1, manual flash 0, 1).
 *
 * SCATTERING, the marcher's: the phase is two forward lobes of anisotropy `phaseForwardAnisotropy`
 * (0.8) and `phaseSecondAnisotropy` (0.166667) blended by `phaseBlend` (0.575); the multiple
 * scattering takes `multiScatterOctaves` (2) more orders, each with its scattering
 * `multiScatterContribution` (0.666667) and extinction `multiScatterOcclusion` (0.25) squared into
 * the next and its phase `multiScatterEccentricity` (0.18) towards the isotropic one.
 */
export const CLOUD_MATERIAL_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    positive('layoutRepeatKm', 256, 'a finite number of kilometres above 0'),
    vector('placement', [0, 0, 0, 0]),
    vector('typeWeights', [1, 1, 1, 2]),
    vector('typePatternScale', [1, 1, 1, 1]),
    vector('maskTypeWeights', [0, 0, 0, 1]),
    number('coverageBias', -0.2, ANY),
    vector('wind', [1, 1, 0.5, 0.333333]),
    vector('erosionNoise', [4.167, 4.444, 9.091, 7]),
    vector('distortionNoise', [60, 60, 75, -6]),
    vector('detailNoise', [30, 40, 25, 8]),
    vector('detailNoiseMultiplier', [0, 0, 1, 0.4]),
    flag('thirdNoise', false),
    vector('noiseBias', [0.5, 0.8, 0.5]),
    vector('noiseStrength', [0.8, 0.08, 0.03, 2.5]),
    number('densityPerMetre', 0.008, ANY),
    vector('albedo', [0.98, 0.98, 0.98]),
    number('ambientOcclusion', 0.5, ANY),
    number('stormAmount', 0, ANY),
    vector('stormAlbedo', [0.3, 0.3375, 0.375]),
    number('stormOcclusionFactor', 0.333333, ANY),
    number('lightningTextureScale', 6, ANY),
    vector('lightningColor', [2, 1.8, 2, 10]),
    vector('lightningSource', [6, 0.05, 0.175, 2.5]),
    vector('lightningMasks', [10, 5, 0.5, 1]),
    vector('lightningAnimation', [0, 0.1, 0, 1]),
    number('phaseForwardAnisotropy', 0.8, [-0.999, 0.999]),
    number('phaseSecondAnisotropy', 0.166667, [-0.999, 0.999]),
    number('phaseBlend', 0.575, [0, 1]),
    number('multiScatterContribution', 0.666667, [0, 1]),
    number('multiScatterOcclusion', 0.25, [0, 1]),
    number('multiScatterEccentricity', 0.18, [0, 1]),
    integerSetting('multiScatterOctaves', 2, [0, 2]),
  ] as const))()

/** The material's settings as resolved. */
export type CloudMaterial = SettingValues<typeof CLOUD_MATERIAL_RULES>
