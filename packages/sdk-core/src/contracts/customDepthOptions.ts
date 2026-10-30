import {
  flagSetting as flag,
  integerSetting as integer,
  rulesOf,
  contextReader,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the custom depth: a second depth of the view (and a stencil beside it) that holds only the objects which ask
 * for it (`Object3D.renderCustomDepth`), whatever stands in front of them, for an outline or a post-process material to read against
 * the scene's depth. Run-time settings, as `./settingRules.ts` says; the quality levels write none of them.
 *
 * `customDepth` picks the feature: 0 off, 1 on with the targets made when an object asks and let go after, 2 on with the targets kept
 * once made, 3 as 2 with the stencil written too (each object's `customDepthStencilValue`, 0 to 255, through its
 * `customDepthStencilWriteMask`). `customDepthOrder` says when it is drawn: 0 ahead of the opaque surfaces, 1 after them, 2 (the
 * default) ahead of them only where the view holds decals that read the depth, else after; the custom depth is a view of its own, drawn
 * before the main view's whatever this says, so on WebGPU it has no effect. `customDepthTemporalAAJitter` (true) keeps the
 * temporal jitter of the view in its projection; off, the custom depth is drawn without it, steady. `customDepthEnableFastClear` (false)
 * lets the depth target be cleared by the fast path of the device; WebGPU exposes none, so it has no effect.
 */
export const CUSTOM_DEPTH_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integer('customDepth', 1, [0, 3]),
    integer('customDepthOrder', 2, [0, 2]),
    flag('customDepthTemporalAAJitter', true),
    flag('customDepthEnableFastClear', false),
  ] as const))()

/** The custom depth setting `field` of a runtime's context (`contextReader`): its default where the context holds none. */
export const readCustomDepthSetting = /* @__PURE__ */ contextReader(CUSTOM_DEPTH_RULES)
/** The field of one setting of the custom depth. */
export type CustomDepthField = keyof typeof CUSTOM_DEPTH_RULES
/** The custom depth's settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type CustomDepthOptions = SettingOptions<typeof CUSTOM_DEPTH_RULES>

/** Whether mode `mode` of `customDepth` writes a stencil (the reference's 3). */
export const customDepthWritesStencil = (mode: number) => mode === 3
