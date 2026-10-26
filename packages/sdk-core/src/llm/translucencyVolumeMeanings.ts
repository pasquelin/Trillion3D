import type { TranslucencyVolumeField } from '../contracts/translucencyVolumeOptions.ts'

/** What each setting of the translucency lighting volume means (`../contracts/translucencyVolumeOptions.ts`):
 *  the field of the direct light around the camera that the see-through surfaces whose material sets
 *  `translucencyLighting` to `'volume'`, `'volumetric'` or `'volumetricNonDirectional'` read. */
export const TRANSLUCENCY_VOLUME_MEANINGS: Readonly<Record<TranslucencyVolumeField, string>> = {
  translucencyVolume:
    "Whether the translucency lighting volume is made, each image: two nested cubes of cells around the camera into which every light is injected, the sun and the local lights each by its own shadow map read at the cell. true by default. Off, no pass runs and a surface that reads the volume reads black; the surfaces whose material lights them 'forward' (what a transmissive surface imported from a scene file is given), and those drawn in a mode other than normal or additive, or of a shading model other than the default lit and the thin subsurface, never read it (a volume mode lights them with no declared light); 'volumetricNonDirectional' is the default of a material made in code.",
  translucencyVolumeDim:
    'Cells a side of each of the two cascades, a whole number from 4 to 2048, held to what the 3D textures of the device hold; 64 by default (24 at smooth and 32 at balanced). More cells resolve the light finer and cost the cube of the number in memory and in the injection.',
  translucencyVolumeInnerDistance:
    'Metres from the camera at which the inner cascade ends, from 0; 15 by default. The inner cascade holds the view from the camera to this distance.',
  translucencyVolumeOuterDistance:
    'Metres from the camera at which the outer cascade ends, from 0; 50 by default. The outer cascade holds the stretch from the inner distance to this one; a surface past it reads the sun unshadowed and no local light.',
  translucencyVolumeBlur:
    'Whether each cell is the mean of eight trilinear reads of the light round it, which hides the cells; true by default (false at smooth and balanced). It runs after the temporal blend where translucencyVolumeTemporal is on.',
  translucencyVolumeTemporal:
    'Whether each cell is blended with the same point of the volume of the image before, the share translucencyVolumeHistoryWeight, before the spatial blur; false by default. It gives a jitter-free light that answers a change with a delay.',
  translucencyVolumeHistoryWeight:
    'Share of the image before kept in each cell when translucencyVolumeTemporal is on, from 0 to 1; 0.9 by default. A higher share is steadier and slower to answer.',
  translucencyVolumePositionOffsetRadius:
    'Cells, from 0; 0 by default. Above 0 a noise of this radius, different for each pixel and image, moves the point a surface reads the volume at, which breaks up the squares of the cells the temporal anti-aliasing then averages.',
  translucencyVolumeAdaptToPerspective:
    "Whether the cascades are sized by the camera's own field of view and aspect, not a field of 45 degrees and a square view; false by default, so that zooming does not change the light.",
  translucencyVolumeMinFov:
    'Degrees, from 0; 45 by default. The least field of view the cascades follow while translucencyVolumeAdaptToPerspective is on, so that zooming in does not make the light pop.',
  translucencyVolumeFovSnap:
    'Degrees, above 0; 10 by default. While translucencyVolumeAdaptToPerspective is on, the field of view is rounded up to a multiple of this, which makes the volume jump in steps as the field animates, not crawl.',
}
