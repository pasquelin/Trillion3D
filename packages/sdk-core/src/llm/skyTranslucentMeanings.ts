import type { SkyQualityField } from '../modules/sky/quality.ts'

/** The setting of the sky's quality that lights the translucent surfaces by the clouds' shade. */
export type SkyTranslucentField = Extract<SkyQualityField, 'cloudShadowOnTranslucent'>

/** What it means (`../modules/sky/quality.ts`). */
export const SKY_TRANSLUCENT_MEANINGS: Readonly<Record<SkyTranslucentField, string>> = {
  cloudShadowOnTranslucent:
    "The project switch of the clouds' shade on translucent surfaces, read once when the session opens (changing it later changes nothing): the shade the clouds cast on the forward directional light — the one of the highest forwardShadingPriority, then the brightest — also dims that light on the translucent surfaces, read from the clouds' shadow map at each vertex and interpolated over the triangle, so it costs a vertex a read and a pixel nothing. false, the default, the translucent programs hold none of that code and the clouds shade only opaque surfaces and the fog.",
}
