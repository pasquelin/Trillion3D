import { flagSetting as flag, rulesOf, contextReader, type SettingOptions } from './settingRules.ts'

/**
 * The run-time settings of the post-process materials (`material.postProcess`, joined to the image by
 * `world.effects.blendables`). Run-time settings, as `./settingRules.ts` says; the quality levels write none of them.
 *
 * `postProcessMaterials` (true) is the show flag of the materials: off, the image is the one without them.
 * `postProcessDisableMaterials` (false) turns them off whatever the show flag says. `postProcessAllowStencilTest` (true)
 * lets a material draw only the pixels its stencil test passes (`enableStencilTest`); off, it draws them all.
 * `postProcessAllowBlendModes` (true) lets a material that outputs alpha blend by it; off, it replaces the pixel.
 */
export const POST_PROCESS_MATERIAL_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('postProcessMaterials', true),
    flag('postProcessDisableMaterials', false),
    flag('postProcessAllowStencilTest', true),
    flag('postProcessAllowBlendModes', true),
  ] as const))()

/** The post-process material setting `field` of a runtime's context (`contextReader`): its default where the context holds none. */
export const readPostProcessMaterialSetting = /* @__PURE__ */ contextReader(
  POST_PROCESS_MATERIAL_RULES,
)
/** The field of one setting of the post-process materials. */
export type PostProcessMaterialField = keyof typeof POST_PROCESS_MATERIAL_RULES
/** The post-process materials' settings as a host writes them. */
export type PostProcessMaterialOptions = SettingOptions<typeof POST_PROCESS_MATERIAL_RULES>
