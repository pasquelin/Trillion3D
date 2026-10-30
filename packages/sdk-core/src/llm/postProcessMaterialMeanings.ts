import {
  POST_PROCESS_MATERIAL_RULES,
  type PostProcessMaterialField,
} from '../contracts/postProcessMaterialOptions.ts'

const R = POST_PROCESS_MATERIAL_RULES

/** What each post-process material setting means, for the schemas an agent reads. */
export const POST_PROCESS_MATERIAL_MEANINGS = {
  postProcessMaterials: `Whether the post-process materials the image holds (world.effects.blendables) are drawn; ${R.postProcessMaterials.default} by default. Off, the image is the one without them.`,
  postProcessDisableMaterials: `Turns every post-process material off whatever postProcessMaterials says; ${R.postProcessDisableMaterials.default} by default.`,
  postProcessAllowStencilTest: `Whether a post-process material with enableStencilTest draws only the pixels whose custom stencil passes its comparison (it needs customDepth 3); ${R.postProcessAllowStencilTest.default} by default. Off, it draws every pixel.`,
  postProcessAllowBlendModes: `Whether a post-process material with blendableOutputAlpha blends by its opacity output; ${R.postProcessAllowBlendModes.default} by default. Off, it replaces the pixel.`,
} as const satisfies Record<PostProcessMaterialField, string>
