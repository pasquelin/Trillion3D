import type { RectLightAtlasField } from '../contracts/rectLightAtlasOptions.ts'

/** What the settings of the rectangle lights' source-texture atlas mean (`../contracts/rectLightAtlasOptions.ts`). */
export const RECT_LIGHT_ATLAS_MEANINGS: Readonly<Record<RectLightAtlasField, string>> = {
  rectLightAtlasMaxResolution:
    'The most texels a side of the atlas that keeps the pictures mapped on the rectangle lights, from 64 to 16384; 4096 by default. Past it the pictures are packed a mip level smaller until they fit.',
  rectLightAtlasDebug:
    'Whether the atlas is drawn over the image with its slots, the packing horizon and the free rectangles, and its figures reported (false, the default).',
  rectLightAtlasDebugMipLevel:
    'The mip level of the atlas the debug view shows, from 0 to 15; 0 by default.',
  rectLightAtlasForceUpdate:
    'Whether the atlas is made again from nothing at every image (false, the default).',
  rectLightAtlasResetOnChange:
    'Whether the atlas is packed again from nothing each time a picture joins it (false, the default).',
  rectLightAtlasClear:
    'Whether the atlas is cleared each time it is made again or changed with the reset on change (false, the default).',
  rectLightAtlasDebugClear:
    'Whether a new atlas is filled with magenta before any picture is written, to show the texels no slot covers (false, the default).',
  rectLightAtlasFilterQuality:
    'How the mip levels of the atlas are filtered: 0, the default, a box of 2 by 2 texels; 1, a Gaussian approximation.',
  rectLightAtlasMaxTextureRatio:
    "The most the width of a picture may exceed its height, or its height its width, from 1 to 16; 2 by default. Past it the picture's short side is stretched to keep the ratio.",
  rectLightAtlasFormat:
    'The texels of the atlas: 0, the default, 11, 11 and 10 bits (faster, the hue may shift; a device that cannot draw into it keeps 16-bit floats); 1, four 16-bit floats (more accurate, slower).',
  sampledLightsTexturedRectLights:
    'Whether the sampled lighting shades the rectangle lights that name a picture with it (true, the default).',
}
