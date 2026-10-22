import type { ShadowField } from '../contracts/shadowOptions.ts'

/** The setting of the shadows that governs how the raster groups the lights' views
 *  (`../contracts/shadowOptions.ts`). */
export type ShadowViewField = Extract<ShadowField, 'shadowMultipassViews'>

/** What it means. */
export const SHADOW_VIEW_MEANINGS: Readonly<Record<ShadowViewField, string>> = {
  shadowMultipassViews:
    'Whether the shadow raster draws the lights in several passes when their maps would pass what one pass lists: the cull runs one row of its dispatch a listed map, so a pass lists at most the rows a dispatch has, 65 535 on any device, far more than a frame holds — the raster takes one pass for every frame of a device that grants it; each light whole in one pass; false, every light in one pass however many maps there are. The pages drawn are the same either way.',
}
