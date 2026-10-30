import { CUSTOM_DEPTH_RULES, type CustomDepthField } from '../contracts/customDepthOptions.ts'

const R = CUSTOM_DEPTH_RULES

/** What each custom depth setting means, for the schemas an agent reads. */
export const CUSTOM_DEPTH_MEANINGS = {
  customDepth: `Whether the custom depth is drawn, a whole number from 0 to 3 (${R.customDepth.default} by default): 0 off, 1 on with its targets made when an object sets renderCustomDepth and let go after, 2 on with its targets kept once made, 3 as 2 with the stencil written too (the objects' customDepthStencilValue through their customDepthStencilWriteMask).`,
  customDepthOrder: `When the custom depth is drawn, a whole number from 0 to 2 (${R.customDepthOrder.default} by default): 0 ahead of the opaque surfaces, 1 after them, 2 ahead of them only where the view reads decals, else after. It has no effect in this engine: the custom depth is a view of its own, drawn before the main view's.`,
  customDepthTemporalAAJitter: `Whether the custom depth keeps the temporal jitter of the view; true by default. Off, it is drawn without the jitter, so the edges of a post-process outline do not shimmer. Reads only while the temporal antialiasing runs.`,
  customDepthEnableFastClear:
    "Whether the custom depth target may be cleared by the device's fast path; false by default. It has no effect in WebGPU, which exposes no fast clear.",
} as const satisfies Record<CustomDepthField, string>
