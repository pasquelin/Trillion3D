import type { TranslucencyGiField } from '../contracts/translucencyGiOptions.ts'

/** What each setting of the translucency global illumination volume means (`../contracts/translucencyGiOptions.ts`):
 *  the grid of indirect light, fitted to the view, that see-through surfaces read with one filtered fetch. */
export const TRANSLUCENCY_GI_MEANINGS: Readonly<Record<TranslucencyGiField, string>> = {
  translucencyGi:
    'Whether the translucency global illumination volume is made each image: a grid of cells fitted to the view whose indirect light see-through surfaces (blend, water, transmission) read with one fetch. true by default. Off, no pass runs and those surfaces take the sky light irradiance alone.',
  translucencyGiTraceFromVolume:
    'Whether each cell marches the global distance field before it reads the radiance cache; true by default. Off, the cells read the cache alone, which is cheaper and sees no near geometry.',
  translucencyGiRadianceCache:
    "Whether the cells read the world's radiance cache (the screen probes' cache) for the light the march leaves; true by default. Off, what the march misses is the sky.",
  translucencyGiRadianceCacheClipmapBias:
    'Cascades, a whole number from 0; 3 by default. The cells read and mark the cache this many cascades coarser than the one covering them, so the cells that fill the view do not take the probes the opaque surfaces need.',
  translucencyGiGridPixelSize:
    'Pixels, a whole number from 1 to 1024; 32 by default. The side of a cell across the image (the largest power of two within it is used). Smaller cells resolve the light finer and cost more.',
  translucencyGiGridDistributionLogZScale:
    'Per metre, above 0; 1 by default (0.01 per centimetre). The scale of the logarithm that spaces the depth slices.',
  translucencyGiGridDistributionLogZOffset:
    'From 0; 1 by default. The offset added inside the logarithm that spaces the depth slices, which sets the first slice depth.',
  translucencyGiGridDistributionZScale:
    'Slices per doubling of the depth, above 0; 4 by default. More slices resolve depth finer.',
  translucencyGiEndDistance:
    'Metres from the camera, 0.01 to 1000; 80 by default. The depth of the last slice; a surface past it reads that slice.',
  translucencyGiTracingResolution:
    'Whole number from 1 to 16; 3 by default. A cell traces this number squared of cones, along the sides of its octahedron.',
  translucencyGiMaxRayIntensity:
    "From 0; 20 by default. The most radiance a cone brings back, in the image's exposure units; brighter cones are scaled down to it.",
  translucencyGiGridCenterOffsetFromDepthBuffer:
    'Cells, from -1; 0.5 by default. How far in front of the depth buffer the trace point of a cell lying behind it is held, which cuts self-intersection and flicker; negative disables it.',
  translucencyGiOffsetThresholdToAcceptDepthBufferOffset:
    'Cells, from 0; 1 by default. A cell is moved forward only if it lies less than this behind the depth, so cells deep behind a surface are left alone.',
  translucencyGiSpatialFilter:
    'Whether the cones light is filtered along the three axes of the grid; true by default.',
  translucencyGiSpatialFilterSampleCount:
    'Cells either side of the filter centre, a whole number from 1; 3 by default (a 7 tap filter).',
  translucencyGiSpatialFilterStandardDeviation:
    'Cells, from 0.1; 5 by default. The Gaussian of the spatial filter; a large value makes it a box, a small one a sharp filter.',
  translucencyGiTemporalReprojection:
    'Whether the volume is blended with the volume of the image before, reprojected; true by default. It steadies the light and answers a change with a delay.',
  translucencyGiTemporalJitter:
    'Whether the point of a cell the light is traced from, and the cone directions, turn from one image to the next so the history averages them; true by default.',
  translucencyGiTemporalHistoryWeight:
    'Share of the history kept each image, 0 to 1; 0.9 by default. Higher is steadier and slower to answer.',
  translucencyGiTemporalMaxRayDirections:
    'Whole number from 1; 8 by default. The turns the cone directions take before they come round.',
}
