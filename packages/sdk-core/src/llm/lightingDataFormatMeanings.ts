import type { LightingDataFormatField } from '../contracts/lightingDataFormatOptions.ts'

/** What each setting of the lighting data format means (`../contracts/lightingDataFormatOptions.ts`). */
export const LIGHTING_DATA_FORMAT_MEANINGS: Readonly<Record<LightingDataFormatField, string>> = {
  lightingDataFormat:
    'One of r11g11b10, rgba16 or rgba32; r11g11b10 by default. The format the light is kept at between the passes of the indirect light (the screen probes, the radiance cache, the translucency volume): 11-11-10 floats, half floats (more precision) or single floats. The 11-11-10 format needs the device feature texture-formats-tier1; a device without it stores half floats rounded to the 11-11-10 floats. A family with a setting of its own for it follows this one when its own is global.',
}
