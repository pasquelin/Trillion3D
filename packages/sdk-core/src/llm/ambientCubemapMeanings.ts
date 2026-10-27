import type { AmbientCubemapField } from '../contracts/ambientCubemapOptions.ts'

/** What the ambient cubemap's settings mean (`../contracts/ambientCubemapOptions.ts`). The cube itself, the field that is no
 *  setting, is `ambientCubemap`: the six faces of a cube of the host's (`size` texels across, a power of two from 16 to 1024, and the faces' linear colours), none
 *  by default, and with none the image draws nothing of it. The defaults and the ranges are the schema's own. */
export const AMBIENT_CUBEMAP_MEANINGS: Readonly<Record<AmbientCubemapField, string>> = {
  ambientCubemapTintRed:
    "The red of the tint the ambient cubemap's light is multiplied by, from 0, 1 by default: a linear colour, written as its three channels beside ambientCubemapTintGreen and ambientCubemapTintBlue.",
  ambientCubemapTintGreen:
    "The green of the tint the ambient cubemap's light is multiplied by, from 0, 1 by default.",
  ambientCubemapTintBlue:
    "The blue of the tint the ambient cubemap's light is multiplied by, from 0, 1 by default.",
  ambientCubemapIntensity:
    "The scale of the ambient cubemap's light, from 0, 1 by default; it multiplies the tint. With a tint and an intensity whose product is black, or with no cube, the image draws no ambient cubemap.",
}
