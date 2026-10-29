import type { SubsurfaceScatteringField } from '../contracts/subsurfaceScatteringOptions.ts'

/** What each setting of the screen-space subsurface scattering means (`../contracts/subsurfaceScatteringOptions.ts`): the light that
 *  enters a surface of the subsurface-profile model and leaves it nearby, spread over its neighbours in the lit image. */
export const SUBSURFACE_SCATTERING_MEANINGS: Readonly<Record<SubsurfaceScatteringField, string>> = {
  subsurfaceScattering:
    'Whether the diffuse light of the surfaces that use the subsurface-profile shading model is scattered over their neighbours, each image; true by default. Off, such a surface is lit as a plain one.',
  subsurfaceScale:
    "A scale on every profile's scatter radius, from 0; 1 by default. 0 turns the scattering off, below 1 it is narrower, above 1 wider. The quality presets write 0 at smooth and 0.75 at balanced.",
  subsurfaceHalfResolution:
    "Whether the scattering runs at half the image's size, which is faster and of lower quality; false by default (true at smooth, balanced and fine).",
  subsurfaceHalfResolutionSeparable:
    "In half resolution, whether every profile is scattered by the separable passes whatever the profile asks for; true by default. Off, the profile's own choice stands.",
  subsurfaceRecombineQuality:
    'How the lit image is reconstructed and recombined, -1 to 1; 1 (high, sharper details) by default. 0 is low and -1 automatic, high; an image accumulated in time is recombined high whatever this says.',
  subsurfaceFilter:
    'Whether the scattered image is read with the bilinear filter; true by default. Off, the nearest texel is read.',
  subsurfaceSampleSet:
    'The samples of the separable passes, 0 to 2; 2 by default. 0 is the lowest quality (6 a side), 1 medium (9) and 2 high (13).',
  subsurfaceCheckerboard:
    "How the lit image holds the light of a subsurface-profile pixel, 0 to 2; 2 by default. 0 keeps its diffuse light's luminance in the image's alpha, 1 puts the diffuse light on one pixel of two and the specular on the other (lower quality), 2 chooses 0 here, the lit image having an alpha channel.",
  subsurfaceCheckerboardNeighborValidation:
    'With the checkerboard on, whether a neighbour that is not a subsurface-profile pixel adds nothing to the reconstruction, which sharpens the borders and reads a pixel more; false by default.',
  subsurfaceBurleyQuality:
    "0 scatters every profile with the separable passes (the transmission stays the profile's own); 1 (default) is automatic: the sampled scattering, the separable passes only in half resolution.",
  subsurfaceBurleySamples:
    "A count of samples a pixel for the sampled scattering, from 0; 0 (default) lets the pixel's variance choose it.",
  subsurfaceBurleyProfileIdCache:
    "Whether the profile of each pixel is kept in a texture of the scattering's resolution, which the passes read in place of the surfaces; true by default. It costs a byte a pixel and makes the sampled scattering much faster.",
  subsurfaceBurleyBilateralKernel:
    'How a sample weighs against the pixel in the sampled scattering, 0 or 1; 1 by default. 0 weighs by depth alone (faster), 1 by depth and normal (better at the eyelids).',
  subsurfaceBurleyMipsMinTileCount:
    'The count of tiles of sampled scattering from which the mip chain of the diffuse light is made, from 0; 4000 by default. 0 makes it always.',
  subsurfaceSubpixelThreshold:
    "The share of the scattering inside the pixel's own footprint above which a tile is not scattered at all, from 0; 1 by default.",
  subsurfaceSamplingChannel:
    'Which channel of a profile steers the sampled scattering, 0 or 1; 1 by default. 0 is the largest diffuse mean free path, 1 the largest mean free path.',
  subsurfaceColorTransmittanceDistance:
    "The distance, 0.05 to 1 (0.15 by default), at which the subsurface colour of a surface that uses the subsurface shading model is read as the transmittance of the light through it: the nearer, the more the transmitted light shifts its hue toward the colour's own.",
  subsurfaceDebugPixel:
    'Whether the pixel under the debug cursor (sampledLightsDebugCursorX and Y, the middle of the image by default) is written on the image, at full resolution only: its coordinate, its reconstructed and recombined lighting and its profile; false by default.',
}
