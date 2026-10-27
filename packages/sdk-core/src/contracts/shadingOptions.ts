import { clamp } from '../../../math/src/scalar/reals.ts'
import {
  ANY_NUMBER,
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  contextReader,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the material pass's shading
 * (`packages/sdk-browser/src/visibility/shader/shadeBinsWgsl.ts`): how the shading bins hold each
 * material class's pixels, and how many layers a surface is shaded with. Run-time settings, as
 * `./settingRules.ts` says.
 */

/** The binning modes of `shadeBinningMode`, the reference's default first: `auto` as the class's
 *  shading asks — by quad of 2 × 2 where it reads a neighbour's derivative, by pixel otherwise;
 *  every class of the engine takes its gradients from its own triangle, so by pixel —, `pixel`
 *  every class's pixels one by one, `quad` every class's by quad, a quad's lanes on pixels of
 *  another class idle. The image is the same in each mode. */
const SHADE_BINNING_MODES = ['auto', 'pixel', 'quad'] as const
/** One binning mode. */
export type ShadeBinningMode = (typeof SHADE_BINNING_MODES)[number]

/** The shading's settings by field, each with the reference's default: the bins' mode as the
 *  classes ask, the eye's iris lit by the iris direction
 *  the `tangent` output gives, not by an iris normal beside the surface's (`irisNormal` false), the clear coat sharing its base's normal (`clearCoatNormal` false), the surfaces' diffuse light rough (`shadingRoughDiffuse` true: the energy-preserving rough diffuse of a new project, which the roughness darkens at grazing angles and brightens against the light, Lambert's where false), the visibility of the surfaces' specular lobes exact (`shadingAccurate` true: the joint Smith visibility of the GGX lobe, a desktop project's; false, its approximation), and the curve a material's `normalCurvatureToRoughness` takes its roughness by:
 *  the change of the vertex normal across a pixel, raised to `normalCurvatureExponent`, times `normalCurvatureScale`, plus
 *  `normalCurvatureBias`, and the GPU timing's detail (`gpuTimingDetail` false): true, a sampled frame times the
 *  material pass's bins and each class's shading apart, as passes of their own, and the diagnostic stage of the shading kernel
 *  (`gpuShadeStage` 0, the whole kernel): 1 to 5 stop each class's shading after its binned pixel, its triangle's header and indices,
 *  its vertex fetch and transform, its interpolation and derivatives, its material and surface, writing nothing but a sink, to time the
 *  stages by difference. The three take any number and are held to their ranges where read
 *  (`NORMAL_CURVATURE_RANGES`, `normalCurvatureClamped`), as the engines that fixed them clamp what they read. */
export const SHADING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choice('shadeBinningMode', 'auto', SHADE_BINNING_MODES),
    flag('irisNormal', false),
    flag('clearCoatNormal', false),
    flag('shadingRoughDiffuse', true),
    flag('shadingAccurate', true),
    flag('gpuTimingDetail', false),
    integer('gpuShadeStage', 0, [0, 7]),
    number('normalCurvatureScale', 1, ANY_NUMBER),
    number('normalCurvatureBias', 0, ANY_NUMBER),
    number('normalCurvatureExponent', 0.333, ANY_NUMBER),
  ] as const))()
/** The shading setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readShadingSetting = /* @__PURE__ */ contextReader(SHADING_RULES)
/** The field of one setting of the shading. */
export type ShadingField = keyof typeof SHADING_RULES
/** The shading's settings as a host writes them, by their fields: each its value, or nothing for
 *  its default. */
export type ShadingOptions = SettingOptions<typeof SHADING_RULES>

/** The ranges the normal curvature's scale, bias and exponent are held to where they are read, both ends included. */
const NORMAL_CURVATURE_RANGES = {
  scale: [0, 2],
  bias: [-1, 1],
  exponent: [0.05, 20],
} as const

/** The normal curvature's scale, bias and exponent held to `NORMAL_CURVATURE_RANGES`, written in `out` from `at` (an image allocates none). */
export function normalCurvatureClamped(
  scale: number,
  bias: number,
  exponent: number,
  out: { [i: number]: number },
  at = 0,
) {
  const { scale: s, bias: b, exponent: e } = NORMAL_CURVATURE_RANGES
  out[at] = clamp(scale, s[0], s[1])
  out[at + 1] = clamp(bias, b[0], b[1])
  out[at + 2] = clamp(exponent, e[0], e[1])
  return out
}
