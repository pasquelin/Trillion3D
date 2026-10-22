// The labels of the GPU passes that have no label module of their own, and the declaration of each
// (`passDeclaration.ts`): each pass reads its label here, so the profile and the passes share one
// word, and the pass table — which the public profile reads, in the CDN core — holds none of the
// passes nor their shaders.
import { definePass, definePassFamily } from './passDeclaration.ts'

/** What every pass of the virtual shadow maps' label opens with (`../../lighting/shadows/vsm/`): all of them are timed
 *  with the Shadows stage, whatever their chunk or light. */
export const VSM_PASS_PREFIX = 'vsm.'
/** The placement's compute passes: the roots' world matrices (`../../placement/compose/gpuCompose.ts`) and,
 *  in the image's command buffer, their motion (`../../placement/compose/composedMotionPass.ts`); their
 *  world boxes and stretches (`../../placement/roots/rootBoxes.ts`), then the rows'; the leaf boxes of the
 *  placement tree (`../../placement/tree/treeLeaves.ts`) and its refit (`../../geometry/dag/tree/treeRefit.ts`). */
export const COMPOSE_ROOTS_PASS = 'Trillion3D compose roots'
export const COMPOSE_MOTION_PASS = 'Trillion3D compose motion'
export const ROOT_BOXES_PASS = 'Trillion3D root boxes'
export const COMPOSE_ROWS_PASS = 'Trillion3D compose rows'
export const TREE_LEAVES_PASS = 'Trillion3D placement tree leaves'
export const TREE_REFIT_PASS = 'Trillion3D placement tree refit'
/** The DAG selection's compute pass, and the swap of its masks (`../../gpu/dag/`). */
export const DAG_SELECTION_PASS = 'Trillion3D DAG selection'
export const DAG_MASK_SWAP_PASS = 'Trillion3D DAG mask swap'
/** The visibility's opening compute pass: the main pass's draw compaction
 *  (`../../frame/render/encodeVis.ts`). */
export const PARTITION_PASS = 'Trillion3D partition'
/** The occlusion step between the two visibility passes, one compute pass: the Hi-Z pyramid's
 *  build from the depth drawn so far (`../../visibility/passes/passes.ts`). */
export const HIZ_PASS = 'Trillion3D HiZ'
/** The hardware raster's render passes: the occluders' depth, the tested half's, then every
 *  drawn half's identifiers (`../../frame/render/encodeVisSetup.ts`). */
export const VISIBILITY_PRIMARY_PASS = 'Trillion3D visibility primary'
export const VISIBILITY_SECONDARY_PASS = 'Trillion3D visibility secondary'
export const VISIBILITY_IDENTIFIERS_PASS = 'Trillion3D visibility identifiers'
/** The software raster's passes and the visibility buffer's resolves
 *  (`../../visibility/raster/raster.ts`, `../../visibility/raster/resolve.ts`): they write the
 *  same buffer as the hardware raster's passes. */
export const RASTER_BINNING_PASS = 'Trillion3D raster binning'
export const RASTER_OCCLUDER_DEPTH_PASS = 'Trillion3D raster occluder depth'
export const RASTER_TESTED_DEPTH_PASS = 'Trillion3D raster tested depth'
export const RASTER_IDENTIFIERS_PASS = 'Trillion3D raster identifiers'
export const RASTER_OCCLUDER_HIZ_PASS = 'Trillion3D raster occluder hiz'
export const RASTER_RESOLVE_PASS = 'Trillion3D raster resolve'
/** The surfaces' clear when the image draws no material
 *  (`../../frame/render/encodeVisSetup.ts`). */
export const EMPTY_SURFACES_PASS = 'Trillion3D empty surfaces'
/** The material resolve's clear of the surfaces and the feedback target, before its compute pass
 *  stores the classes' pixels (`../../materials/classes/materialPasses.ts`). */
export const MATERIAL_SURFACES_PASS = 'Trillion3D material surfaces v1'
/** The resolve's compute pass: what the frame composes once for it
 *  (`../../visibility/shader/shadeCacheWgsl.ts`), the shading bins
 *  (`../../visibility/shader/shadeBinKernelsWgsl.ts`), then each class's shading of its bin — the material
 *  pass's time. */
export const MATERIAL_COMPUTE_PASS = 'Trillion3D material cache, bins and shading'
/** The texture feedback's reduction of the tile atlases (`../../webgpu/tile/`). */
export const TEXTURE_FEEDBACK_REDUCE_PASS = 'Trillion3D texture feedback reduce'
/** The tile pools' victim queues, ranked on the places the feedback stamped
 *  (`../../materials/virtual/evictSort.ts`). */
export const TEXTURE_EVICTION_PASS = 'Trillion3D texture eviction queue'
/** The blend passes (`../../webgpu/blend/`): the transparents — every layer, the transmissive ones
 *  under the dual blend among them — and the dual blend's companion pass, the distortion's
 *  accumulation and application, the order and expansion, the display mask and the display filter. */
export const TRANSPARENTS_PASS = 'Trillion3D transparents'
export const BLEND_COMPANION_PASS = 'Trillion3D blend companion'
export const DISTORTION_PASS = 'Trillion3D distortion'
export const DISTORTION_APPLY_PASS = 'Trillion3D distortion apply'
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
/** The light grid pass over the bounce's world lattice (`../../lighting/tiles/tiles.ts`, `world`):
 *  timed with the bounce, which reads its lists. */
export const BOUNCE_LIGHT_LISTS_PASS = 'Trillion3D bounce light lists v1'
/** The reflections' compute pass of the depth pyramid's nearest mips (`../../lighting/reflections/frame.ts`). */
export const REFLECTION_PASS = 'Trillion3D reflections'
/** The reflections' tile classification and screen stage, both surfaces' (`../../lighting/reflections/trace/trace.ts`). */
export const REFLECTION_TRACE_PASS = 'Trillion3D reflection trace'
/** The reflections' scene stage, the rays the screen left, both surfaces'. */
export const REFLECTION_SCENE_PASS = 'Trillion3D reflection scene'
/** The reflections' spatial reuse, temporal accumulation and last pass, both surfaces'. */
export const REFLECTION_DENOISE_PASS = 'Trillion3D reflection denoise'
/** The pose of the deformed placements' proxies: their corners moved, their bounds fitted again, before the
 *  reflections and the bounce trace them (`../../geometry/dag/proxy/proxyPose.ts`). */
export const PROXY_POSE_PASS = 'Trillion3D proxy pose'
/** The radiance pyramid of the lit image, which the next image's reflections read. */
export const REFLECTION_RADIANCE_PASS = 'Trillion3D reflection radiance'
/** The deferred lighting pass; `gpuLightingMs` is read under this name. */
export const DEFERRED_LIGHTING_PASS = 'Trillion3D deferred lighting'
/** The seed of the as-is share the temporal resolve reads (`../../lighting/deferred/asIsShare.ts`). */
export const AS_IS_SHARE_PASS = 'Trillion3D as-is share seed'
/** The temporal resolve; its timestamp duration absorbs that of the passes that precede it on
 *  some devices (apple metal-3), and is only read safely by envelope difference. */
export const TAA_PASS = 'Trillion3D temporal antialiasing'
/** The automatic exposure's histogram and update, one compute pass (`../../post/exposure/meter.ts`). */
export const EXPOSURE_PASS = 'Trillion3D exposure'
/** The scene's half-size copy and its chain of ever smaller levels, which the bloom and the local
 *  exposure read (`../../post/filters/sceneChain.ts`). */
export const DOWNSAMPLE_PASS = 'Trillion3D scene downsample'
/** The local exposure's grid of the image's log luminance, its blurred luminance and its blur
 *  (`../../post/finish/local.ts`). */
export const LOCAL_EXPOSURE_PASS = 'Trillion3D local exposure'
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

/** The virtual shadow maps' passes: their labels carry their chunk, set or kernel. */
export const VSM_PASSES = definePassFamily({
  prefix: VSM_PASS_PREFIX,
  stage: 'shadows',
  block: 'other',
})

/** The stage and block of each pass labelled above. */
export const ENGINE_PASSES = [
  definePass({ label: COMPOSE_ROOTS_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: COMPOSE_MOTION_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: COMPOSE_ROWS_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: ROOT_BOXES_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: TREE_LEAVES_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: TREE_REFIT_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: DAG_SELECTION_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: DAG_MASK_SWAP_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: PARTITION_PASS, stage: 'partition', block: 'visibility' }),
  definePass({ label: HIZ_PASS, stage: 'hiZ', block: 'visibility' }),
  definePass({ label: VISIBILITY_PRIMARY_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: VISIBILITY_SECONDARY_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: VISIBILITY_IDENTIFIERS_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_BINNING_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_OCCLUDER_DEPTH_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_TESTED_DEPTH_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_IDENTIFIERS_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_OCCLUDER_HIZ_PASS, stage: 'hiZ', block: 'visibility' }),
  definePass({ label: RASTER_RESOLVE_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: EMPTY_SURFACES_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: MATERIAL_COMPUTE_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: MATERIAL_SURFACES_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: TEXTURE_FEEDBACK_REDUCE_PASS, stage: 'textures', block: 'other' }),
  definePass({ label: TEXTURE_EVICTION_PASS, stage: 'textures', block: 'other' }),
  definePass({ label: TRANSPARENTS_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: BLEND_COMPANION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISTORTION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISTORTION_APPLY_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSPARENT_COMPACTION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSPARENT_OCCLUSION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: BLEND_ORDER_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISPLAY_MASK_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISPLAY_FILTER_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSPARENT_FRONT_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: PARTICLE_DRAW_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: LIGHT_TILES_PASS, stage: 'lightLists', block: 'other' }),
  definePass({ label: BOUNCE_PASS, stage: 'bounce', block: 'other' }),
  definePass({ label: BOUNCE_LIGHT_LISTS_PASS, stage: 'bounce', block: 'other' }),
  definePass({ label: PROXY_POSE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_TRACE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_SCENE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_DENOISE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_RADIANCE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: PARTICLES_PASS, stage: 'physics', block: 'other' }),
  definePass({ label: DEFERRED_LIGHTING_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: AS_IS_SHARE_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: EXPOSURE_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: DOWNSAMPLE_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: LOCAL_EXPOSURE_PASS, stage: 'effects', block: 'other' }),
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
