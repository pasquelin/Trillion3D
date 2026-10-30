import type { SampledLightsField } from '../contracts/sampledLightsOptions.ts'

/** What the view's sampled lighting settings mean (`../contracts/sampledLightsOptions.ts`). */
export const SAMPLED_LIGHTS_MEANINGS: Readonly<Record<SampledLightsField, string>> = {
  sampledLights:
    'Whether the view lights with the sampled lighting (false, the default): each pixel draws a few lights among the many that reach it, traces one shadow ray per draw and denoises the result over time and space, so the cost of many shadow casting lights stays fixed. True turns it on for every light that allows it.',
  sampledLightsDirectional:
    'Whether directional lights join the sampled lighting (false, the default).',
  sampledLightsShadowMethod:
    "How a light that names no shadow method is shadowed by the sampled lighting: 'rayTracing' (the default), traced rays, or 'virtualShadowMap', the virtual shadow maps.",
  sampledLightsDownsample:
    'The pixels one sampled pixel covers: 0 one, 1 two (a checkerboard), 2 four (the default).',
  sampledLightsHairVoxelTraces:
    'Whether the surfaces’ rays traced through the distance field are also marched through the hair strands’ voxels, so that hair shades the surfaces (true, the default); only where the view holds hair.',
  sampledLightsHairStrands:
    'Whether the hair strands’ samples are lit by the sampled lighting, their lights drawn and traced through the hair voxels (true, the default).',
  sampledLightsHairDownsample:
    'The same as sampledLightsDownsample for the hair strands (0, the default).',
  sampledLightsSamplesPerPixel:
    'The samples of one sampled pixel (4, the default): 4 or more take a 2 by 2 layout, 2 or 3 a 2 by 1, 1 one.',
  sampledLightsHairSamplesPerPixel:
    'The same as sampledLightsSamplesPerPixel for the hair strands (4, the default).',
  sampledLightsMinSampleWeight:
    'The weight under which a sample is skipped as too faint to show (0.001, the default).',
  sampledLightsAttenuationFalloff:
    'The base colour luminance the early light culling assumes (0.18, the default); higher culls less (the least light weighed is the least sample weight over it), 0 culls nothing early.',
  sampledLightsGuideByHistory:
    'Whether a light that was hidden in the last image is drawn less often (true, the default), which lessens noise where a bright light is shadowed.',
  sampledLightsGuideByHistoryFilter:
    "Whether each tile's sets of seen and hidden lights are joined with its four neighbours' before they guide the next image (true, the default), which spreads what is known of a light to the tiles beside it; needs sampledLightsGuideByHistory.",
  sampledLightsHiddenWeight:
    'The share, from 0 to 1 (0.1, the default), of its weight in the draw that a light hidden in the last image keeps.',
  sampledLightsHiddenWeightOnHistoryMiss:
    'The same share (0.4, the default) for a pixel that has no history.',
  sampledLightsDirectionalFraction:
    'The most of the samples, from 0 to 1 (0.5, the default), the directional lights may take; higher makes them better and the local lights worse.',
  sampledLightsDirectionalMinClampWeight:
    'The weight (0.01, the default) under which the directional lights are not held to their fraction.',
  sampledLightsMergeRays:
    'Whether a ray that repeats another is skipped (true, the default): two to the same point light, or one outside a penumbra.',
  sampledLightsVsmMarkPages:
    'Whether the virtual shadow maps’ pages are marked from the drawn samples alone (true, the default). False marks every page the lights of a pixel’s cell might need, which costs more pages and needs no sample before the maps are drawn.',
  sampledLightsShadingConfidence:
    'Whether the filters spare the pixels the draw sampled well, passing their signal through (true, the default).',
  sampledLightsMaxShadingWeight:
    'The most a sample weighs when it is shaded (20, the default): low-probability samples are held to it, which lessens fireflies.',
  sampledLightsMaxShadingWeightHidden:
    'The same limit (5, the default) for a sample of a light that was hidden in the last image and turns out visible.',
  sampledLightsScreenTraces:
    'Whether the shadow rays of the sampled lighting first march the image depth (true, the default); what they meet there shadows the sample.',
  sampledLightsScreenTraceIterations: 'The iterations of that march (50, the default).',
  sampledLightsScreenTraceDistance:
    'How far, in metres, the march goes along a ray (1, the default).',
  sampledLightsScreenTraceThickness:
    'The thickness of a surface the march hits, as a share of its depth (0.005, the default).',
  sampledLightsScreenTraceNormalBias:
    'How far, in metres, the start of the march is moved along the surface normal (0.0005, the default).',
  sampledLightsScreenTraceHair:
    'Whether a hair pixel’s shadow rays march the image depth too (true, the default).',
  sampledLightsScreenTraceHairBias:
    'How far, in metres, the start of a hair pixel’s ray is moved along the ray (0.01, the default).',
  sampledLightsHairUnshadowedDistance:
    'The longest ray, in metres, a hair pixel casts toward a light that casts no shadow, for the hair’s self shadowing (0.2, the default); 0 casts none.',
  sampledLightsFirstPersonMinimumHit:
    'The least distance, in metres, a ray the screen missed is handed on at when it meets the sphere holding the stand-ins of the first-person objects (0.04, the default).',
  sampledLightsTransmission:
    'Whether the sampled lighting carries the subsurface transmission (true, the default).',
  sampledLightsTransmissionSampleWeight:
    'The transmission assumed, from 0 to 1 (0.1, the default), when a sample is weighed before the transmission is traced.',
  sampledLightsLightingChannels:
    'Whether the lighting channels block the shadowing (true, the default).',
  sampledLightsFastClear:
    'Whether the surfaces pass skips its empty tiles and clears only the borders its filters read (false, the default).',
  sampledLightsHairFastClear:
    'The same as sampledLightsFastClear for the hair strands (true, the default).',
  sampledLightsFrontLayerFastClear:
    'The same as sampledLightsFastClear for the nearest translucent layer (true, the default).',
  sampledLightsFrontLayer:
    'Whether the nearest translucent layer is lit by the sampled lights, in a pass of its own (false, the default); the lights loop then no longer lights it.',
  sampledLightsFrontLayerSpecularOnly:
    'Whether the nearest translucent layer takes only the specular light of the sampled pass, its diffuse light left to the translucency volume (false, the default).',
  sampledLightsFrontLayerSoftShadows:
    'Whether an area light casts a soft shadow on the nearest translucent layer (true, the default).',
  sampledLightsFrontLayerScreenTraces:
    'Whether the rays of the nearest translucent layer march the depth image first (false, the default).',
  sampledLightsFrontLayerTemporal:
    'Whether the nearest translucent layer accumulates its samples over time (true, the default).',
  sampledLightsFrontLayerSpatial:
    'Whether the nearest translucent layer is filtered over space (true, the default).',
  sampledLightsTemporal: 'Whether the samples accumulate over time (true, the default).',
  sampledLightsTemporalHistoryDistance:
    'The relative distance past which an earlier image is discarded (0.03, the default); lower lessens ghosting and raises flicker.',
  sampledLightsTemporalMinFrames:
    'The least length, in images, the history keeps after a history miss (4, the default); higher softens and slows the transitions. Held to the longest.',
  sampledLightsTemporalMaxFrames:
    'The longest history, in images (12, the default): lower has less ghosting and more noise.',
  sampledLightsTemporalClampScale:
    'How permissive the clamp of the history to its neighbourhood is (1, the default): higher increases ghosting and lessens noise and instability.',
  sampledLightsPowerDelta:
    'Whether the change of each light’s power since the image before drives the draw (true, the default): a light just turned on is treated as visible at once.',
  sampledLightsPowerDeltaLightFunctions:
    'Whether the light function is in that power (false, the default); it is evaluated once, at the light’s place, so it may fail for a function animated unevenly.',
  sampledLightsSpatial:
    'Whether the denoiser filters the light over the neighbours of a pixel (true, the default).',
  sampledLightsSpatialDepthWeight:
    'The scale of the depth weight of the spatial filter (10000, the default): smaller lets more samples be reused and blurs unrelated surfaces together.',
  sampledLightsSpatialRadius:
    'The radius, in pixels, of the spatial filter’s kernel (8, the default).',
  sampledLightsSpatialSamples:
    'The samples of the spatial filter (4, the default); doubled while the history is short.',
  sampledLightsSpatialDisocclusionFrames:
    'The images after a disocclusion during which the spatial filter is boosted to lessen noise (2, the default).',
  sampledLightsSpatialDisocclusionDiffuseVariance:
    'The scale of the diffuse spatial variance on a disocclusion (2, the default): higher lessens noise and sharpness.',
  sampledLightsSpatialDisocclusionSpecularVariance:
    'The scale of the specular spatial variance on a disocclusion (1, the default).',
  sampledLightsSpatialHistoryVariance:
    'Whether the spatial variance of the history drives the spatial filter (true, the default).',
  sampledLightsSpatialHistoryDeviation:
    'The deviation of the history’s spatial variance above which the spatial filter is applied (0.15, the default).',
  sampledLightsVolumeDownsample:
    'The fog cells one drawn cell covers along each axis: 0 or 1 one, 2 two (the default); the 2 by 2 by 2 cells of a block share their draw.',
  sampledLightsVolumeWorldSpaceTraces:
    'Whether the lights kept for a fog cell are also shadowed by the global distance field (true, the default); needs the field.',
  sampledLightsVolumeGuideByHistory:
    'Whether a light hidden from the fog cell in the image before is drawn less (true, the default).',
  sampledLightsVolumeGridPixelSize:
    'The pixels one voxel of the fog sampling’s grid covers across (8, the default).',
  sampledLightsVolumeGridSizeZ: 'The depth slices of the fog sampling’s grid (128, the default).',
  sampledLightsVolumeDepthDistributionScale:
    'How the depth slices spread over the depth: higher puts more of them near the eye (32, the default).',
  sampledLightsVolumeHzbOcclusionTest:
    'Whether the fog sampling skips the voxels hidden behind the surfaces (true, the default).',
  sampledLightsVolumeUnified:
    'Whether the translucency lighting volume shares the samples the fog’s volume drew (true, the default).',
  sampledLightsTranslucencyVolume:
    'Whether the translucency lighting volume lights its local lights from the sampled lighting (true, the default).',
  sampledLightsTranslucencyVolumeDownsample:
    'Where the translucency volume has its own samples, the cells one drawn cell covers along each axis: 1 one, 2 two (the default).',
  sampledLightsTranslucencyVolumeSamplesPerVoxel:
    'The samples of a cell of the translucency volume where it has its own (2, the default): 4 or more take 4, less 2.',
  sampledLightsTranslucencyVolumeMinSampleWeight:
    'The least a sample weighs in a translucency volume cell’s light, where it has its own samples (0.1, the default).',
  sampledLightsTranslucencyVolumeGuideByHistory:
    'Whether a light hidden from a translucency volume cell in the image before is drawn less, where it has its own samples (true, the default).',
  sampledLightsVolume:
    'Whether the local lights light the volumetric fog by samples, in place of every light of the cell (true, the default).',
  sampledLightsVolumeSamplesPerVoxel:
    'The samples of a fog cell (2, the default): 4 or more take 4, less 2.',
  sampledLightsVolumeMinSampleWeight:
    'The least a sample weighs in a fog cell’s light, as a share of the cell’s light, for the cell to be lit by samples at all (0.1, the default).',
  sampledLightsVisualize:
    'The numbered debug view of the sampled lighting shown in place of the image (0, none, the default): 1 the overview of the shadow casters, 2 the shadow casters, 3 their quality, 4 and 5 the denoiser overviews, 6 the shading confidence, 7 the frames accumulated, 8 the upsample mask, 9 and 10 the diffuse and specular demodulation, 11 and 12 their deviation, 13 and 14 the history’s spatial deviation, 15 and 16 the history clamp. A named diagnostic mode (sampled-lights-…) shows the first three; this number wins over the mode.',
  sampledLightsVisualizeShadowCasterMissingDistance:
    'In the shadow caster quality view, how far in metres the surface the rays hit may lie behind the drawn one before it is painted missing (0.5, the default), relaxed at a grazing angle.',
  sampledLightsVisualizeShadowCasterPoorDistance:
    'In the shadow caster quality view, how far in metres the surface the rays hit may lie in front of the drawn one before it is painted mismatching (0.25, the default), relaxed at a grazing angle.',
  sampledLightsHardwareRayTracing:
    'Whether the shadow caster views (2 and 3, and the overview) cast one ray from the eye through each pixel against the scene’s triangles and paint what it meets, as the reference does with its hardware rays (true, the default; off with the project’s rayTracing switch). False, or while the scene has no triangles to trace, the views paint the surface alone. A setting of the sampled lights’ rays, not of the view: the debug views follow it.',
  sampledLightsEvaluateMaterialMode:
    'Whether the shadow caster views’ rays honour the surfaces’ cut-out masks (0, none, the default: the rays meet every triangle whole; 1 and 2 evaluate the masks, the reference’s any-hit and closest-hit evaluation, which meet the same surface here). A setting of the sampled lights’ rays, not of the view.',
  sampledLightsForceTwoSided:
    'Whether the shadow caster views’ rays meet the back of one-sided triangles as well as their front (true, the default); false culls the backs. A setting of the sampled lights’ rays, not of the view.',
  sampledLightsVisualizeTileClassification:
    'The tiles of the classification drawn over the image (0, none, the default): 1 the surfaces’ tiles, 2 the downsampled tiles, 3 and 4 the hair strands’, 5 and 6 the nearest translucent layer’s; each tile type has its colour and a count is written.',
  sampledLightsVisualizeLightComplexity:
    'The light complexity view of one input (0, none, the default): 1 the surfaces, 2 the hair strands, 3 the nearest translucent layer, 4 the volume, 5 the translucency volume. It lists, for the pixel under the debug cursor, the lights of its cell with their share of the sampling weight, whether they were seen in the image before, their kind and name, draws a line and a symbol to each, and paints a heat map of the cost of sampling each pixel. Only the surfaces (1) and the nearest translucent layer (3) are drawn yet; the others say so. A named diagnostic mode (sampled-lights-complexity-…) wins over this number.',
  sampledLightsVisualizeLightComplexityMaxLights:
    'The most lights the light complexity list shows (32, the default); the lights are sorted by weight, the heaviest first.',
  sampledLightsVisualizeLightComplexityMaxCost:
    'The cost the light complexity heat map paints red (32, the default), a lower cost going through yellow, green and cyan to blue, a pixel with no cost left grey. 0 draws no heat map.',
  sampledLightsVisualizeLightComplexityFreeze:
    'Whether the light complexity view keeps the list and the lines it last drew (false, the default), so that the cursor can leave the pixel and the camera move; the heat map is then not drawn.',
  sampledLightsVisualizeLightComplexityDump:
    'Whether the light complexity list is written to the console (false, the default): once each time the option is turned on, with the name, the weight and its share, the visibility, the kind and the place of every light.',
  sampledLightsVisualizeLightComplexityHeatmap:
    'Whether the light complexity view paints the heat map of the cost (true, the default), the image in grey times the colour of the cost; false leaves the image as it is.',
  sampledLightsVisualizeLightComplexityLightColor:
    'Whether the lines and symbols of the lights in the light complexity view are in the light’s own colour, dimmed when it was not seen (true, the default), or green, dark green when not seen.',
  sampledLightsDebug:
    'Which input the sampled lighting’s debug prints speak of (0, none, the default): 1 the surfaces, 2 the volume, 3 the translucency volume, 4 the hair strands, 5 the nearest translucent layer.',
  sampledLightsDebugTraceStats:
    'Whether the count of rays each trace method got is written on the image (false, the default); needs sampledLightsDebug.',
  sampledLightsDebugCursorX:
    'The pixel column the light list and the prints inspect (-1, the default: the middle of the image).',
  sampledLightsDebugCursorY:
    'The pixel row the light list and the prints inspect (-1, the default: the middle of the image).',
}
