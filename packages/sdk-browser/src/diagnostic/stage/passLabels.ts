// The labels of the GPU passes that have no label module of their own, and the declaration of each
// (`passDeclaration.ts`): each pass reads its label here, so the profile and the passes share one
// word, and the pass table — which the public profile reads, in the CDN core — holds none of the
// passes nor their shaders.
import { definePass, definePassFamily, type PassFiling } from './passDeclaration.ts'

/** What every pass of the virtual shadow maps' label opens with (`../../lighting/shadows/vsm/`): all of them are timed
 *  with the Shadows stage, whatever their chunk or light. */
export const VSM_PASS_PREFIX = 'vsm.'
/** The placement's compute passes: the roots' world matrices (`../../placement/compose/gpuCompose.ts`); their
 *  world boxes and stretches (`../../placement/roots/rootBoxes.ts`), then the rows'; the leaf boxes of the
 *  placement tree (`../../placement/tree/treeLeaves.ts`) and its refit (`../../geometry/dag/tree/treeRefit.ts`). */
export const COMPOSE_ROOTS_PASS = 'Trillion3D compose roots'
export const ROOT_BOXES_PASS = 'Trillion3D root boxes'
export const COMPOSE_ROWS_PASS = 'Trillion3D compose rows'
export const TREE_LEAVES_PASS = 'Trillion3D placement tree leaves'
export const TREE_REFIT_PASS = 'Trillion3D placement tree refit'
/** The light functions' atlas render pass (`../../lighting/lightFunction/atlas.ts`). */
export const LIGHT_FUNCTION_ATLAS_PASS = 'Trillion3D light function atlas'
/** The DAG selection's compute pass (`../../geometry/dag/`), and the pass that measures the longest
 *  edge of the clusters whose records were written since the last cut
 *  (`../../geometry/dag/info/measure.ts`). */
export const DAG_SELECTION_PASS = 'Trillion3D DAG selection'
export const CLUSTER_MEASURE_PASS = 'Trillion3D cluster measure'
/** The occlusion step between the two visibility passes, one compute pass: the Hi-Z pyramid's
 *  build from the depth drawn so far (`../../visibility/passes/passes.ts`). */
export const HIZ_PASS = 'Trillion3D HiZ'
/** The hardware raster's render passes: the occluders' half and the tested half
 *  (`../../frame/render/encodeVisSetup.ts`). */
export const VISIBILITY_PRIMARY_PASS = 'Trillion3D visibility primary'
export const VISIBILITY_SECONDARY_PASS = 'Trillion3D visibility secondary'
/** The software raster's passes, the binning of the visible clusters that precedes them — their
 *  decode, their bins, the tessellation's seeding — and the export of the visibility buffer
 *  (`../../visibility/raster/raster.ts`, `../../visibility/raster/export.ts`): they write the
 *  same buffer as the hardware raster's passes. */
export const RASTER_BINNING_PASS = 'Trillion3D raster binning'
export const RASTER_OCCLUDER_DEPTH_PASS = 'Trillion3D raster occluder depth'
export const RASTER_TESTED_DEPTH_PASS = 'Trillion3D raster tested depth'
export const RASTER_IDENTIFIERS_PASS = 'Trillion3D raster identifiers'
export const RASTER_OCCLUDER_HIZ_PASS = 'Trillion3D raster occluder hiz'
export const RASTER_RESOLVE_PASS = 'Trillion3D raster resolve'
export const RASTER_DEPTH_EXPORT_PASS = 'Trillion3D raster depth export'
/** The surfaces' clear when the image draws no material
 *  (`../../frame/render/encodeVisSetup.ts`). */
export const EMPTY_SURFACES_PASS = 'Trillion3D empty surfaces'
/** The material resolve's clear of the surfaces and the feedback target, before its compute pass
 *  stores the classes' pixels (`../../materials/classes/materialPasses.ts`). */
export const MATERIAL_SURFACES_PASS = 'Trillion3D material surfaces v1'
/** The resolve's compute pass: the shading bins (`../../visibility/shader/shadeBinKernelsWgsl.ts`),
 *  then each class's shading of its bin, each pixel decoding its own triangle — the material pass's
 *  time. */
export const MATERIAL_COMPUTE_PASS = 'Trillion3D material bins and shading'
/** The material pass as `gpuTimingDetail` splits it: its bins' pass, and a pass for each class's shading, whose
 *  label ends with the class's key (`MATERIAL_SHADING_PASS_PREFIX`). */
export const MATERIAL_BINS_PASS = 'Trillion3D material bins'
export const MATERIAL_SHADING_PASS_PREFIX = 'Trillion3D material shading '
/** The texture feedback's reduction of the tile atlases (`../../webgpu/tile/`). */
export const TEXTURE_FEEDBACK_REDUCE_PASS = 'Trillion3D texture feedback reduce'
/** The tile pools' victim queues, ranked on the places the feedback stamped
 *  (`../../materials/virtual/evictSort.ts`). */
export const TEXTURE_EVICTION_PASS = 'Trillion3D texture eviction queue'
/** The blend passes (`../../webgpu/blend/`): the transparents — every layer, the transmissive ones
 *  under the dual blend among them — the distortion's
 *  accumulation and application, the order and expansion, the display mask and the display filter. */
export const TRANSPARENTS_PASS = 'Trillion3D transparents'
export const BLEND_RESPONSIVE_PASS = 'Trillion3D blend responsiveness'
/** The alpha holdout (`../../blend/holdout.ts`): the target's start from the lit image's alpha, the
 *  layers drawn into it, and its visibility laid back over the lit image's alpha. */
export const HOLDOUT_START_PASS = 'Trillion3D alpha holdout start'
export const BLEND_HOLDOUT_PASS = 'Trillion3D blend alpha holdout'
export const HOLDOUT_APPLY_PASS = 'Trillion3D alpha holdout apply'
/** The layers that multiply the scene, drawn on the modulation target, and the composition of the
 *  translucency onto the image (`../../blend/translucency.ts`). */
export const TRANSLUCENCY_MODULATION_PASS = 'Trillion3D translucency modulation'
export const TRANSLUCENCY_COMPOSE_PASS = 'Trillion3D translucency compose'
export const DISTORTION_PASS = 'Trillion3D distortion'
export const DISTORTION_APPLY_PASS = 'Trillion3D distortion apply'
/** The single-layer water's passes (`../../blend/water/`): the copy of the scene without it, its depth,
 *  the tiles that hold it, the mask of its refraction, its shading and the composite of its reflection. */
export const WATER_COPY_PASS = 'Trillion3D water scene copy'
export const WATER_DEPTH_PASS = 'Trillion3D water depth'
export const WATER_MASK_PASS = 'Trillion3D water refraction mask'
export const WATER_PASS = 'Trillion3D water'
export const WATER_TILES_PASS = 'Trillion3D water tiles'
export const WATER_VELOCITY_PASS = 'Trillion3D water velocity'
export const WATER_COMPOSITE_PASS = 'Trillion3D water composite'
export const BLEND_ORDER_PASS = 'Trillion3D blend order and expansion'
export const DISPLAY_MASK_PASS = 'Trillion3D display mask'
export const DISPLAY_FILTER_PASS = 'Trillion3D display filter'
/** The transparents' front surface the reflection trace reads (`../../lighting/reflections/frontLayer.ts`). */
export const TRANSPARENT_FRONT_PASS = 'Trillion3D transparent front'
/** The transparents' compaction (`../../blend/transparent/compact.ts`) and occlusion test
 *  (`../../gpu/core/transparentOcclusion.ts`). */
export const TRANSPARENT_COMPACTION_PASS = 'Trillion3D transparent compaction'
export const TRANSPARENT_OCCLUSION_PASS = 'Trillion3D transparent occlusion'
/** The particle step and draw, as the GPU timings name them (`passesGpu`). */
export const PARTICLES_PASS = 'Trillion3D particles'
export const PARTICLE_DRAW_PASS = 'Trillion3D particle draw'
/** The light lists' pass; `gpuLightListsMs` is read under this name, not by its rank. */
export const LIGHT_TILES_PASS = 'Trillion3D light tiles v1'
/** The bounce pass — the cells the image reads marked, the table's writes, then the probes' update and
 *  the snapshot's follow-up —; the "Bounce" step is read under this name, not by its rank. */
export const BOUNCE_PASS = 'Trillion3D bounce v1'
/** The screen probes' compute pass: the probes placed on the image, traced, filtered, read by each pixel
 *  and blended with its history (`../../lighting/bounce/screen/encode.ts`); timed with the bounce. */
export const SCREEN_PROBE_PASS = 'Trillion3D screen probes'
/** The reflections' compute pass of the depth pyramid's nearest mips (`../../lighting/reflections/frame.ts`). */
export const REFLECTION_PASS = 'Trillion3D reflections'
/** The reflections' tile classification and screen stage, both surfaces' (`../../lighting/reflections/trace/trace.ts`). */
export const REFLECTION_TRACE_PASS = 'Trillion3D reflection trace'
/** The reflections' scene stage, the rays the screen left, both surfaces'. */
export const REFLECTION_SCENE_PASS = 'Trillion3D reflection scene'
/** The reflections' spatial reuse, temporal accumulation and last pass, both surfaces'. */
export const REFLECTION_DENOISE_PASS = 'Trillion3D reflection denoise'
/** The lighting's passes, in their order (`../../lighting/deferred/deferred.ts`), all timed with the
 *  Lighting stage: the classification of the surfaces into tiles, the lit image's one
 *  pass, which draws the background, the surfaces as they are, the emission, then the directional
 *  lights', the local lights' and the indirect light's draws, in that order, and the fog laid over
 *  the whole image (`../../lighting/fog/fogPass.ts`). */
export const TILE_CLASSIFICATION_PASS = 'Trillion3D tile classification'
export const SURFACE_COLOUR_PASS = 'Trillion3D surface colour'
export const HEIGHT_FOG_PASS = 'Trillion3D height fog'
/** The volumetric lightmap's light on the pixels, gathered before the indirect pass reads it
 *  (`../../lighting/deferred/volumetricLightPass.ts`). */
export const VOLUMETRIC_LIGHT_PASS = 'Trillion3D volumetric lightmap light'
/** The fog's volume, built before the lighting reads it: the furthest depth of its cells, the light
 *  each scatters, the sum along each column (`../../lighting/fog/passes.ts`). */
export const FOG_VOLUME_PASS = 'Trillion3D fog volume'
/** The translucency lighting volume: the light of every light injected into the two cascades of cells around the camera, filtered
 *  and packed, which the see-through surfaces lit from it read (`../../lighting/translucency/gpu.ts`). */
export const TRANSLUCENCY_VOLUME_PASS = 'Trillion3D translucency volume'
/** The translucency global illumination volume: the cones of every cell of the view-fitted grid traced, filtered and integrated into the
 *  harmonics the see-through surfaces read their indirect light from (`../../lighting/translucencyGi/gpu.ts`). */
export const TRANSLUCENCY_GI_PASS = 'Trillion3D translucency global illumination'
/** The screen-space ambient occlusion's passes — the setups of the coarser resolutions, the searches and the last
 *  one that writes the texture the lighting reads (`../../lighting/ao/frame.ts`). */
export const AMBIENT_OCCLUSION_PASS = 'Trillion3D ambient occlusion'
/** The screen-space subsurface scattering: the tile classification, the setup, the two scatterings and the recombine
 *  (`../../lighting/subsurface/frame.ts`). */
export const SUBSURFACE_PASS = 'Trillion3D subsurface scattering'
/** The clear of the responsiveness the blends write and the temporal analysis reads
 *  (`../../blend/responsive.ts`). */
export const RESPONSIVE_CLEAR_PASS = 'Trillion3D responsiveness clear'
/** The velocity stage: the motion of every render texel, drawn before the lighting for the passes
 *  that read it (`../../post/taa/velocity.ts`). */
export const VELOCITY_PASS = 'Trillion3D velocity'
/** The temporal resolve's passes, in their order (`../../post/taa/`), each its own compute pass so
 *  each is timed: the velocity dilated to each texel's closest surface; the render-resolution
 *  histories reprojected (the last image's frame and the frame a pixel may be resurrected from);
 *  the thin geometry detection; the shading rejection, its flicker measure and the merge of the
 *  frames; the spatial anti-aliaser; the history update; the history brought down to the display;
 *  the display layers brought down beside it. */
export const TAA_DILATE_VELOCITY_PASS = 'Trillion3D temporal dilate velocity'
export const TAA_DECIMATE_HISTORY_PASS = 'Trillion3D temporal decimate history'
export const TAA_MEASURE_FLICKERING_LUMA_PASS = 'Trillion3D temporal measure flickering luma'
export const TAA_MEASURE_THIN_COVERAGE_PASS = 'Trillion3D temporal measure thin geometry coverage'
export const TAA_DETECT_THIN_GEOMETRY_PASS = 'Trillion3D temporal detect thin geometry'
export const TAA_RELAX_THIN_GEOMETRY_PASS = 'Trillion3D temporal thin geometry weight relaxation'
export const TAA_REJECT_SHADING_PASS = 'Trillion3D temporal reject shading'
export const TAA_SPATIAL_ANTI_ALIASING_PASS = 'Trillion3D temporal spatial anti-aliasing'
export const TAA_UPDATE_HISTORY_PASS = 'Trillion3D temporal update history'
export const TAA_RESOLVE_HISTORY_PASS = 'Trillion3D temporal resolve history'
export const TAA_RESOLVE_LAYERS_PASS = 'Trillion3D temporal resolve display layers'
/** The automatic exposure's histogram and update, one compute pass (`../../post/exposure/meter.ts`). */
export const EXPOSURE_PASS = 'Trillion3D exposure'
/** The scene's half-size copy and its chain of ever smaller levels, which the bloom and the local
 *  exposure read (`../../post/filters/sceneChain.ts`). */
export const DOWNSAMPLE_PASS = 'Trillion3D scene downsample'
/** The local exposure's grid of the image's log luminance, its blurred luminance and its blur
 *  (`../../post/finish/local.ts`). */
export const LOCAL_EXPOSURE_PASS = 'Trillion3D local exposure'
/** The tone table's baking: the colour the display shows for every light of a small cube, which the
 *  composition reads (`../../lighting/toneLut.ts`). */
export const TONE_TABLE_PASS = 'Trillion3D tone table'
/** Every pass of the motion blur: the flattening of the motion, the spread of its tiles, the
 *  classifying of the filter tiles and the filter itself (`../../post/effects/webgpuMotionBlur.ts`). */
export const MOTION_BLUR_PASS = 'Trillion3D motion blur'
/** Every pass of the depth of field: the setup of the circles of confusion, their tiles, the reduction of
 *  the setup, the bokeh tables, the gather of each layer and its post-filter, the scattered sprites, the
 *  recombine (`../../post/effects/webgpuDepthOfField.ts`). */
export const DEPTH_OF_FIELD_PASS = 'Trillion3D depth of field'
/** Every pass of the bloom: the threshold and local exposure setup, the levels' downsample and
 *  blur, their sum (`../../post/effects/webgpuBloom.ts`). */
export const BLOOM_PASS = 'Trillion3D bloom'
/** Both passes of every outline, its scan and its line over the display image
 *  (`../../post/effects/webgpuOutline.ts`). */
export const OUTLINE_PASS = 'Trillion3D outline'
/** The HDR composition, alone or presenting the canvas too (`../../lighting/deferred/deferred.ts`). */
export const HDR_COMPOSITION_PASS = 'Trillion3D HDR composition'
export const HDR_PRESENT_PASS = 'Trillion3D HDR composition + present'
/** The presents that draw straight to the canvas (`../../gpu/core/presentation.ts`) or to a view
 *  (`../../gpu/core/presentAt.ts`). */
export const DIRECT_PRESENT_PASS = 'Trillion3D direct present'
export const VIEW_PRESENT_PASS = 'Trillion3D view present'
/** The guides drawn over the image (`../../guides/guidePass.ts`). */
export const GUIDE_PASS = 'Trillion3D guides'
/** The x-ray view's edges, drawn over the lit image (`../../visibility/passes/xray.ts`). */
export const XRAY_PASS = 'Trillion3D x-ray'
/** The frame-difference view, the display image against the one before, onto the canvas
 *  (`../../frame/render/frameDifference.ts`). */
export const FRAME_DIFFERENCE_PASS = 'Trillion3D frame difference'
/** The see-through views' background, laid before their transparents
 *  (`../../visibility/passes/xray.ts`). */
export const SEE_THROUGH_BACKGROUND_PASS = 'Trillion3D see-through background'
/** The capture of the emission and occlusion layer (`../../frame/io/surfaceCapture.ts`). */
export const CAPTURE_PASS = 'Trillion3D capture emission and occlusion'

/** The surface cache's update (`../../lighting/surfaceCache/frame.ts`): the captures of the pages the image asks for — their
 *  surfaces shaded, resolved to the cards' encodings, copied into the atlas — in one compute pass. */
export const SURFACE_CACHE_PASS = 'Trillion3D surface cache'
/** The surface cache's lighting (`../../lighting/surfaceCache/lighting/surfaceLighting.ts`): the update context, the direct
 *  light, the radiosity and the final light of the pages' texels, in one compute pass. */
export const SURFACE_CACHE_LIGHTING_PASS = 'Trillion3D surface cache lighting'
/** What every allocation of the surface cache's atlases is labelled with (`../../lighting/surfaceCache/atlases.ts`). */
export const SURFACE_CACHE_ATLAS_LABEL = 'Trillion3D surface cache atlas'

/** The virtual shadow maps' passes: their labels carry their chunk, set or kernel. */
export const VSM_PASSES = definePassFamily({
  prefix: VSM_PASS_PREFIX,
  stage: 'shadows',
  block: 'other',
})

/** The passes whose labels carry what they work on (a face, a cascade, a kernel) and so are filed by
 *  the prefix their labels open with, each stage's in the order of the frame. Every label of a family
 *  is a pass the profile would otherwise leave "unclassified". */
const family = (stage: PassFiling['stage'], ...prefixes: readonly string[]) =>
  prefixes.map((prefix) => definePassFamily({ prefix, stage, block: 'other' }))
export const OTHER_PASS_FAMILIES = [
  // Geometry pages installed on the device, and the picking ray queries (`../../gpu/core/selection.ts`).
  ...family('residency', 'Trillion3D page install'),
  ...family('selection', 'Trillion3D ray query'),
  // The distance fields and what traces them: the shadow of the sun is a shadow, the rest light.
  ...family('shadows', 'Trillion3D sun distance-field shadow'),
  ...family(
    'lighting',
    'Trillion3D distance-field occlusion',
    'Trillion3D global distance field',
    'Trillion3D mesh distance field',
  ),
  // The sky and what it lights: the atmosphere's lookup tables, the sky drawn over the image, the
  // haze on the opaque surfaces, the clouds, the light shafts, the sky light capture and its filters,
  // the local fog volumes and the rewrite of the surfaces.
  ...family(
    'lighting',
    'Trillion3D air',
    'Trillion3D sky',
    'Trillion3D opaque haze',
    'Trillion3D cloud',
    'Trillion3D light shafts',
    'Trillion3D fog local volumes',
    'Trillion3D surface rewrite',
  ),
  // The surface cache's card captures, feedback, clears and debug views (its update and lighting
  // keep their own rows below).
  ...family('surfaceCache', 'Trillion3D card capture', 'Trillion3D surface cache '),
  ...family('reflections', 'Trillion3D inspection reflection'),
]
/** The material pass's detail passes, filed with the material pass (`geometry`, `materials`). */
export const MATERIAL_DETAIL_FAMILIES = [MATERIAL_BINS_PASS, MATERIAL_SHADING_PASS_PREFIX].map(
  (prefix) => definePassFamily({ prefix, stage: 'geometry', block: 'materials' }),
)

/** The stage and block of each pass labelled above. */
export const ENGINE_PASSES = [
  definePass({ label: COMPOSE_ROOTS_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: COMPOSE_ROWS_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: ROOT_BOXES_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: TREE_LEAVES_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: TREE_REFIT_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: DAG_SELECTION_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: CLUSTER_MEASURE_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: HIZ_PASS, stage: 'hiZ', block: 'visibility' }),
  definePass({ label: VISIBILITY_PRIMARY_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: VISIBILITY_SECONDARY_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_BINNING_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_OCCLUDER_DEPTH_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_TESTED_DEPTH_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_IDENTIFIERS_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_OCCLUDER_HIZ_PASS, stage: 'hiZ', block: 'visibility' }),
  definePass({ label: RASTER_RESOLVE_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_DEPTH_EXPORT_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: EMPTY_SURFACES_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: MATERIAL_COMPUTE_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: MATERIAL_SURFACES_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: TEXTURE_FEEDBACK_REDUCE_PASS, stage: 'textures', block: 'other' }),
  definePass({ label: TEXTURE_EVICTION_PASS, stage: 'textures', block: 'other' }),
  definePass({ label: TRANSPARENTS_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: BLEND_RESPONSIVE_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: HOLDOUT_START_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: BLEND_HOLDOUT_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: HOLDOUT_APPLY_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSLUCENCY_MODULATION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSLUCENCY_COMPOSE_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISTORTION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISTORTION_APPLY_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: WATER_COPY_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: WATER_DEPTH_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: WATER_MASK_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: WATER_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: WATER_TILES_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: WATER_VELOCITY_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: WATER_COMPOSITE_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSPARENT_COMPACTION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSPARENT_OCCLUSION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: BLEND_ORDER_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISPLAY_MASK_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISPLAY_FILTER_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSPARENT_FRONT_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: PARTICLE_DRAW_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: SURFACE_CACHE_PASS, stage: 'surfaceCache', block: 'other' }),
  definePass({ label: SURFACE_CACHE_LIGHTING_PASS, stage: 'surfaceCache', block: 'other' }),
  definePass({ label: LIGHT_TILES_PASS, stage: 'lightLists', block: 'other' }),
  definePass({ label: BOUNCE_PASS, stage: 'bounce', block: 'other' }),
  definePass({ label: SCREEN_PROBE_PASS, stage: 'bounce', block: 'other' }),
  definePass({ label: REFLECTION_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_TRACE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_SCENE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_DENOISE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: PARTICLES_PASS, stage: 'physics', block: 'other' }),
  definePass({ label: TILE_CLASSIFICATION_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: SURFACE_COLOUR_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: HEIGHT_FOG_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: LIGHT_FUNCTION_ATLAS_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: VOLUMETRIC_LIGHT_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: FOG_VOLUME_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: TRANSLUCENCY_VOLUME_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: TRANSLUCENCY_GI_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: AMBIENT_OCCLUSION_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: SUBSURFACE_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: RESPONSIVE_CLEAR_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: VELOCITY_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_DILATE_VELOCITY_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_DECIMATE_HISTORY_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_MEASURE_FLICKERING_LUMA_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_MEASURE_THIN_COVERAGE_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_DETECT_THIN_GEOMETRY_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_RELAX_THIN_GEOMETRY_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_REJECT_SHADING_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_SPATIAL_ANTI_ALIASING_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_UPDATE_HISTORY_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_RESOLVE_HISTORY_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_RESOLVE_LAYERS_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: EXPOSURE_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: DOWNSAMPLE_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: LOCAL_EXPOSURE_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: TONE_TABLE_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: MOTION_BLUR_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: DEPTH_OF_FIELD_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: BLOOM_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: OUTLINE_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: HDR_COMPOSITION_PASS, stage: 'present', block: 'other' }),
  definePass({ label: HDR_PRESENT_PASS, stage: 'present', block: 'other' }),
  definePass({ label: DIRECT_PRESENT_PASS, stage: 'present', block: 'other' }),
  definePass({ label: VIEW_PRESENT_PASS, stage: 'present', block: 'other' }),
  definePass({ label: GUIDE_PASS, stage: 'present', block: 'other' }),
  definePass({ label: XRAY_PASS, stage: 'present', block: 'other' }),
  definePass({ label: FRAME_DIFFERENCE_PASS, stage: 'present', block: 'other' }),
  definePass({ label: SEE_THROUGH_BACKGROUND_PASS, stage: 'present', block: 'other' }),
  definePass({ label: CAPTURE_PASS, stage: 'present', block: 'other' }),
]
