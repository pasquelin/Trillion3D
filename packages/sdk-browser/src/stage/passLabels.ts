// The labels of the GPU passes that have no label module of their own, and the declaration of each
// (`passDeclaration.ts`): each pass reads its label here, so the profile and the passes share one
// word, and the pass table — which the public profile reads, in the CDN core — holds none of the
// passes nor their shaders.
import { definePass, definePassFamily } from './passDeclaration.ts'

/** What every pass of the virtual shadow maps' label opens with (`../vsm/`): all of them are timed
 *  with the Shadows stage, whatever their chunk or light. */
export const VSM_PASS_PREFIX = 'vsm.'
/** The placement's two compute passes: the roots' world matrices, then the rows'
 *  (`../placement/gpuCompose.ts`). */
export const COMPOSE_ROOTS_PASS = 'Trillion3D compose roots'
export const COMPOSE_ROWS_PASS = 'Trillion3D compose rows'
/** The DAG selection's compute pass, and the swap of its masks (`../gpu/dag/`). */
export const DAG_SELECTION_PASS = 'Trillion3D DAG selection'
export const DAG_MASK_SWAP_PASS = 'Trillion3D DAG mask swap'
/** The visibility's opening compute pass: the GPU partition, then the draw compaction that reads
 *  the rest bits and slot counts it wrote. */
export const PARTITION_PASS = 'Trillion3D partition'
/** The occlusion step between the two visibility passes, one compute pass: the Hi-Z pyramid's
 *  build, the test of the tested half against it and the compaction of what survives. */
export const HIZ_PASS = 'Trillion3D HiZ'
/** The two visibility render passes, the occluders' then the tested half's
 *  (`../webgpu/visibility/passes.ts`). */
export const VISIBILITY_PRIMARY_PASS = 'Trillion3D visibility primary'
export const VISIBILITY_SECONDARY_PASS = 'Trillion3D visibility secondary'
/** The compute raster's passes (`../gpu/raster/raster.ts`, `../gpu/raster/resolve.ts`): they build
 *  the same buffer as the visibility passes. */
export const RASTER_BINNING_PASS = 'Trillion3D raster binning'
export const RASTER_OCCLUDER_DEPTH_PASS = 'Trillion3D raster occluder depth'
export const RASTER_TESTED_DEPTH_PASS = 'Trillion3D raster tested depth'
export const RASTER_IDENTIFIERS_PASS = 'Trillion3D raster identifiers'
export const RASTER_OCCLUDER_HIZ_PASS = 'Trillion3D raster occluder hiz'
export const RASTER_RESOLVE_PASS = 'Trillion3D raster resolve'
/** The impostor cards' surface pass, and their visibility pass. */
export const IMPOSTOR_PASS = 'Trillion3D impostor cards'
export const IMPOSTOR_VISIBILITY_PASS = `${IMPOSTOR_PASS} visibility`
/** The surfaces' clear when the image draws no material
 *  (`../webgpu/pages/render/encodeVisSetup.ts`). */
export const EMPTY_SURFACES_PASS = 'Trillion3D empty surfaces'
/** The material resolve pass, as the profile and the pass blocks read it. */
export const MATERIAL_SURFACES_PASS = 'Trillion3D material surfaces v1'
/** The resolve's compute pass: what the frame composes once for it
 *  (`../visibility/shader/shadeCacheWgsl.ts`), then the material classification
 *  (`../visibility/shader/materialTilesWgsl.ts`). */
export const MATERIAL_COMPUTE_PASS = 'Trillion3D material cache and tiles'
/** The texture feedback's reduction and the texel turn of the tile atlases (`../webgpu/tile/`). */
export const TEXTURE_FEEDBACK_REDUCE_PASS = 'Trillion3D texture feedback reduce'
export const TEXEL_TURN_PASS = 'Trillion3D texel turn'
/** The blend passes (`../webgpu/blend/`): the transparents, the transmissive ones, the order and
 *  expansion, the display mask and the display filter. */
export const TRANSPARENTS_PASS = 'Trillion3D transparents'
export const TRANSMISSION_PASS = 'Trillion3D transmission'
export const BLEND_ORDER_PASS = 'Trillion3D blend order and expansion'
export const DISPLAY_MASK_PASS = 'Trillion3D display mask'
export const DISPLAY_FILTER_PASS = 'Trillion3D display filter'
/** The transparents' compaction (`../webgpu/transparent/compact.ts`) and occlusion test
 *  (`../gpu/core/transparentOcclusion.ts`). */
export const TRANSPARENT_COMPACTION_PASS = 'Trillion3D transparent compaction'
export const TRANSPARENT_OCCLUSION_PASS = 'Trillion3D transparent occlusion'
/** The particle step and draw, as the GPU timings name them (`passesGpu`). */
export const PARTICLES_PASS = 'Trillion3D particles'
export const PARTICLE_DRAW_PASS = 'Trillion3D particle draw'
/** The light lists' pass; `gpuLightListsMs` is read under this name, not by its rank. */
export const LIGHT_TILES_PASS = 'Trillion3D light tiles v1'
/** The bounce pass — the surface cache's sweep, then the probes' update and the snapshot's
 *  follow-up —; the "Bounce" step is read under this name, not by its rank. */
export const BOUNCE_PASS = 'Trillion3D bounce v1'
/** The clear of a probe level the bounce grows (`../bounce/probeStorage.ts`). */
export const BOUNCE_PROBE_CLEAR_PASS = 'Trillion3D bounce probe level clear'
/** The reflections' compute pass: the depth pyramid's nearest mips, then the opaque surfaces'
 *  trace (`../reflections/frame.ts`). */
export const REFLECTION_PASS = 'Trillion3D reflections'
/** The radiance pyramid of the lit image, which the next image's reflections read. */
export const REFLECTION_RADIANCE_PASS = 'Trillion3D reflection radiance'
/** The deferred lighting pass; `gpuLightingMs` is read under this name. */
export const DEFERRED_LIGHTING_PASS = 'Trillion3D deferred lighting'
/** The seed of the as-is share the temporal resolve reads (`../lighting/deferred/asIsShare.ts`). */
export const AS_IS_SHARE_PASS = 'Trillion3D as-is share seed'
/** The temporal resolve; its timestamp duration absorbs that of the passes that precede it on
 *  some devices (apple metal-3), and is only read safely by envelope difference. */
export const TAA_PASS = 'Trillion3D temporal antialiasing'
/** Every pass of the bloom chain, down and up its levels (`../webgpu/effects/webgpuBloom.ts`). */
export const BLOOM_PASS = 'Trillion3D bloom'
/** The HDR composition, alone or presenting the canvas too (`../lighting/deferred/deferred.ts`). */
export const HDR_COMPOSITION_PASS = 'Trillion3D HDR composition'
export const HDR_PRESENT_PASS = 'Trillion3D HDR composition + present'
/** The presents that draw straight to the canvas (`../gpu/core/presentation.ts`) or to a view
 *  (`../gpu/core/presentAt.ts`). */
export const DIRECT_PRESENT_PASS = 'Trillion3D direct present'
export const VIEW_PRESENT_PASS = 'Trillion3D view present'
/** The guides drawn over the image (`../guides/guidePass.ts`). */
export const GUIDE_PASS = 'Trillion3D guides'
/** The capture of the emission and occlusion layer (`../webgpu/pages/io/surfaceCapture.ts`). */
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
  definePass({ label: COMPOSE_ROWS_PASS, stage: 'animations', block: 'other' }),
  definePass({ label: DAG_SELECTION_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: DAG_MASK_SWAP_PASS, stage: 'selection', block: 'visibility' }),
  definePass({ label: PARTITION_PASS, stage: 'partition', block: 'visibility' }),
  definePass({ label: HIZ_PASS, stage: 'hiZ', block: 'visibility' }),
  definePass({ label: VISIBILITY_PRIMARY_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: VISIBILITY_SECONDARY_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_BINNING_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_OCCLUDER_DEPTH_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_TESTED_DEPTH_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_IDENTIFIERS_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: RASTER_OCCLUDER_HIZ_PASS, stage: 'hiZ', block: 'visibility' }),
  definePass({ label: RASTER_RESOLVE_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: IMPOSTOR_VISIBILITY_PASS, stage: 'geometry', block: 'visibility' }),
  definePass({ label: EMPTY_SURFACES_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: MATERIAL_COMPUTE_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: MATERIAL_SURFACES_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: IMPOSTOR_PASS, stage: 'geometry', block: 'materials' }),
  definePass({ label: TEXTURE_FEEDBACK_REDUCE_PASS, stage: 'textures', block: 'other' }),
  definePass({ label: TEXEL_TURN_PASS, stage: 'textures', block: 'other' }),
  definePass({ label: TRANSPARENTS_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSMISSION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSPARENT_COMPACTION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: TRANSPARENT_OCCLUSION_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: BLEND_ORDER_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISPLAY_MASK_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: DISPLAY_FILTER_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: PARTICLE_DRAW_PASS, stage: 'transparents', block: 'other' }),
  definePass({ label: LIGHT_TILES_PASS, stage: 'lightLists', block: 'other' }),
  definePass({ label: BOUNCE_PASS, stage: 'bounce', block: 'other' }),
  definePass({ label: BOUNCE_PROBE_CLEAR_PASS, stage: 'bounce', block: 'other' }),
  definePass({ label: REFLECTION_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: REFLECTION_RADIANCE_PASS, stage: 'reflections', block: 'other' }),
  definePass({ label: PARTICLES_PASS, stage: 'physics', block: 'other' }),
  definePass({ label: DEFERRED_LIGHTING_PASS, stage: 'lighting', block: 'other' }),
  definePass({ label: AS_IS_SHARE_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: TAA_PASS, stage: 'antialiasing', block: 'other' }),
  definePass({ label: BLOOM_PASS, stage: 'effects', block: 'other' }),
  definePass({ label: HDR_COMPOSITION_PASS, stage: 'present', block: 'other' }),
  definePass({ label: HDR_PRESENT_PASS, stage: 'present', block: 'other' }),
  definePass({ label: DIRECT_PRESENT_PASS, stage: 'present', block: 'other' }),
  definePass({ label: VIEW_PRESENT_PASS, stage: 'present', block: 'other' }),
  definePass({ label: GUIDE_PASS, stage: 'present', block: 'other' }),
  definePass({ label: CAPTURE_PASS, stage: 'present', block: 'other' }),
]
