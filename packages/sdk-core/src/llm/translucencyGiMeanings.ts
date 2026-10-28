import type { TranslucencyGiField } from '../contracts/translucencyGiOptions.ts'

/** What each setting of the translucency global illumination volume means (`../contracts/translucencyGiOptions.ts`):
 *  the grid of indirect light, fitted to the view, that see-through surfaces read with one filtered fetch. */
export const TRANSLUCENCY_GI_MEANINGS: Readonly<Record<TranslucencyGiField, string>> = {
  translucencyGi:
    'Whether the translucency global illumination volume is made each image: a grid of cells fitted to the view whose indirect light see-through surfaces (blend, water, transmission) read with one fetch. true by default. Off, no pass runs and those surfaces take the sky light irradiance alone.',
  translucencyGiTraceFromVolume:
    'Whether each cell marches the global distance field before it reads the radiance cache; true by default. Off, the cells read the cache alone, which is cheaper and sees no near geometry.',
  translucencyGiRadianceCache:
    "Whether the cells read a radiance cache for the light the march leaves; true by default. Off, what the march misses is the sky. The cache is one of the volume's own unless translucencyGiShareRadianceCacheWithOpaque is on.",
  translucencyGiShareRadianceCacheWithOpaque:
    "Whether the volume reads the world's radiance cache (the screen probes' cache) instead of one of its own; false by default. Shared, it costs less and gives less control over the probes' spacing: the cells mark the probes they read in the world's pool, translucencyGiRadianceCacheClipmapBias cascades coarser, and the cache settings below are not used.",
  translucencyGiRadianceCacheClipmapBias:
    "Cascades, a whole number from 0; 3 by default. Only when the cache is shared (translucencyGiShareRadianceCacheWithOpaque): the cells read and mark the cache this many cascades coarser than the one covering them, so the cells that fill the view do not take the probes the opaque surfaces need. The volume's own cache is read and marked at the cascade that covers a cell.",
  translucencyGiRadianceCacheClipmapWorldExtent:
    "Metres, above 0; 25 by default (2500 centimetres in the reference). Half the side of the first level of the volume's own radiance cache, from the eye to a side of its cube; each next level is translucencyGiRadianceCacheClipmapDistributionBase times wider, and as many levels are made as cover translucencyGiEndDistance.",
  translucencyGiRadianceCacheClipmapDistributionBase:
    "From 1; 2 by default. How much wider each level of the volume's own radiance cache is than the one before it.",
  translucencyGiRadianceCacheGridResolution:
    "Whole number from 1 to 256; 24 by default. The cells a side of each level of the volume's own radiance cache, each of which may hold a probe: more cells make the probes closer and cost more probes.",
  translucencyGiRadianceCacheProbeResolution:
    "Whole number from 8 to 64; 8 by default. The texels a side of the map of the light by direction that each probe of the volume's own radiance cache keeps.",
  translucencyGiRadianceCacheNumMipmaps:
    "Whole number from 1 to 3; 3 by default. The levels of detail of the probes' maps in the volume's own radiance cache, which a cone wider than a texel reads.",
  translucencyGiRadianceCacheNumProbesToTraceBudget:
    "Whole number from 1; 100 by default. The probes of the volume's own radiance cache traced each image, counted in the cost of a whole map each. More probes follow a change of light faster and cost more.",
  translucencyGiRadianceCacheProbeAtlasResolutionInProbes:
    "Whole number from 1 to 255; 128 by default. The probes along a side of the atlas of the volume's own radiance cache: it holds this number squared of probes (rounded up to rows of a power of two), and a cell asked for past that goes unanswered until a probe is given back.",
  translucencyGiRadianceCacheReprojectionRadiusScale:
    "From 0; 10 by default. A probe of the volume's own radiance cache is read along a direction moved onto a sphere round it, this many times the nearest its rays start: a larger sphere moves the direction less.",
  translucencyGiLightingDataFormat:
    "One of global, r11g11b10, rgba16 or rgba32; rgba16 by default (global follows lightingDataFormat). The format of the cones' light the volume traces and filters before it projects it, and of the ambient volume the surfaces read: half floats (eight bytes a texel), 11-11-10 floats (four bytes a texel) or single floats (the ambient volume keeps half floats for it). The default keeps more precision than the reference's 11-11-10 floats, on purpose; r11g11b10 gives the reference's format. The 11-11-10 format needs the device feature texture-formats-tier1; a device without it keeps half floats. The directional volume the surfaces read is always half floats.",
  translucencyGiGridPixelSize:
    'Pixels, a whole number from 1 to 1024; 32 by default. The side of a cell across the image (the largest power of two within it is used). Smaller cells resolve the light finer and cost more.',
  translucencyGiGridDistributionLogZScale:
    'Per metre, above 0; 1 by default (0.01 per centimetre). The scale of the logarithm that spaces the depth slices.',
  translucencyGiGridDistributionLogZOffset:
    'From 0; 1 by default. The offset added inside the logarithm that spaces the depth slices, which sets the first slice depth.',
  translucencyGiGridDistributionZScale:
    'Slices per doubling of the depth, above 0; 4 by default. More slices resolve depth finer.',
  translucencyGiEndDistance:
    'Metres from the camera, 0.01 to 1000; 80 by default. The depth of the last slice; a surface past it reads that slice. It is multiplied by globalDistanceFieldTraceViewDistance over 20000 (a scale held to 0.1 to 100, the result to the same range), so the default view distance leaves it as set.',
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
