// The GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and the profile files a span by that label alone (`../../diagnostic/stage/passTable.ts`).
// Every label a pass begins with is a constant of a label module, and every one of them is declared
// once, with its stage and block, in that module (`../../diagnostic/stage/passDeclaration.ts`); the virtual
// shadow maps' passes, whose labels carry their chunk, set or kernel, are one declared family.
import test from 'node:test'
import assert from 'node:assert/strict'
import { WEBGPU_STAGES } from '../../diagnostic/stage/passDeclaration.ts'
import { passRowOf } from '../../diagnostic/stage/passTable.ts'
import {
  AS_IS_SHARE_PASS,
  BLEND_ORDER_PASS,
  MOTION_BLUR_PASS,
  VELOCITY_PASS,
  BLOOM_PASS,
  BOUNCE_LIGHT_LISTS_PASS,
  BOUNCE_PASS,
  SCREEN_PROBE_PASS,
  CAPTURE_PASS,
  COMPOSE_MOTION_PASS,
  COMPOSE_ROOTS_PASS,
  COMPOSE_ROWS_PASS,
  DAG_MASK_SWAP_PASS,
  DAG_SELECTION_PASS,
  DEFERRED_LIGHTING_PASS,
  DEPTH_OF_FIELD_PASS,
  FOG_VOLUME_PASS,
  AMBIENT_OCCLUSION_PASS,
  DIRECT_PRESENT_PASS,
  DISPLAY_FILTER_PASS,
  DISPLAY_MASK_PASS,
  DOWNSAMPLE_PASS,
  EMPTY_SURFACES_PASS,
  ENGINE_PASSES,
  EXPOSURE_PASS,
  GUIDE_PASS,
  HDR_COMPOSITION_PASS,
  HDR_PRESENT_PASS,
  HIZ_PASS,
  LIGHT_TILES_PASS,
  LOCAL_EXPOSURE_PASS,
  MATERIAL_COMPUTE_PASS,
  MATERIAL_SURFACES_PASS,
  OUTLINE_PASS,
  PARTICLE_DRAW_PASS,
  PARTICLES_PASS,
  PARTITION_PASS,
  PROXY_POSE_PASS,
  RASTER_BINNING_PASS,
  RASTER_IDENTIFIERS_PASS,
  RASTER_OCCLUDER_DEPTH_PASS,
  RASTER_OCCLUDER_HIZ_PASS,
  RASTER_RESOLVE_PASS,
  RASTER_TESTED_DEPTH_PASS,
  REFLECTION_PASS,
  REFLECTION_RADIANCE_PASS,
  REFLECTION_TRACE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_DENOISE_PASS,
  ROOT_BOXES_PASS,
  TAA_PASS,
  TEXTURE_EVICTION_PASS,
  TEXTURE_FEEDBACK_REDUCE_PASS,
  TREE_LEAVES_PASS,
  TREE_REFIT_PASS,
  BLEND_COMPANION_PASS,
  DISTORTION_PASS,
  DISTORTION_APPLY_PASS,
  TRANSPARENT_COMPACTION_PASS,
  TRANSPARENT_FRONT_PASS,
  TRANSPARENT_OCCLUSION_PASS,
  TRANSPARENTS_PASS,
  VIEW_PRESENT_PASS,
  VISIBILITY_IDENTIFIERS_PASS,
  VISIBILITY_PRIMARY_PASS,
  VISIBILITY_SECONDARY_PASS,
  VSM_PASS_PREFIX,
  XRAY_PASS,
  SEE_THROUGH_BACKGROUND_PASS,
  FRAME_DIFFERENCE_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { MIPS_PASSES, TEXTURE_MIPS_PASS } from '../../materials/texture/mipsPass.ts'
import {
  ANIMATION_BANK_PASS,
  DEFORMATION_PASS,
  DEFORMATION_PASSES,
} from '../../deformation/pass.ts'

/** The labels the engine's passes begin with, as the passes import them. */
const BEGUN = [
  AS_IS_SHARE_PASS,
  BLEND_ORDER_PASS,
  MOTION_BLUR_PASS,
  VELOCITY_PASS,
  BLOOM_PASS,
  BOUNCE_LIGHT_LISTS_PASS,
  BOUNCE_PASS,
  SCREEN_PROBE_PASS,
  CAPTURE_PASS,
  COMPOSE_MOTION_PASS,
  COMPOSE_ROOTS_PASS,
  COMPOSE_ROWS_PASS,
  DAG_MASK_SWAP_PASS,
  DAG_SELECTION_PASS,
  DEFERRED_LIGHTING_PASS,
  DEPTH_OF_FIELD_PASS,
  FOG_VOLUME_PASS,
  AMBIENT_OCCLUSION_PASS,
  DEFORMATION_PASS,
  ANIMATION_BANK_PASS,
  DIRECT_PRESENT_PASS,
  DISPLAY_FILTER_PASS,
  DISPLAY_MASK_PASS,
  DOWNSAMPLE_PASS,
  EMPTY_SURFACES_PASS,
  EXPOSURE_PASS,
  GUIDE_PASS,
  HDR_COMPOSITION_PASS,
  HDR_PRESENT_PASS,
  HIZ_PASS,
  LIGHT_TILES_PASS,
  LOCAL_EXPOSURE_PASS,
  MATERIAL_COMPUTE_PASS,
  MATERIAL_SURFACES_PASS,
  OUTLINE_PASS,
  PARTICLE_DRAW_PASS,
  PARTICLES_PASS,
  PARTITION_PASS,
  PROXY_POSE_PASS,
  RASTER_BINNING_PASS,
  RASTER_IDENTIFIERS_PASS,
  RASTER_OCCLUDER_DEPTH_PASS,
  RASTER_OCCLUDER_HIZ_PASS,
  RASTER_RESOLVE_PASS,
  RASTER_TESTED_DEPTH_PASS,
  REFLECTION_PASS,
  REFLECTION_RADIANCE_PASS,
  REFLECTION_TRACE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_DENOISE_PASS,
  ROOT_BOXES_PASS,
  TAA_PASS,
  TEXTURE_EVICTION_PASS,
  TEXTURE_FEEDBACK_REDUCE_PASS,
  TREE_LEAVES_PASS,
  TREE_REFIT_PASS,
  TEXTURE_MIPS_PASS,
  BLEND_COMPANION_PASS,
  DISTORTION_PASS,
  DISTORTION_APPLY_PASS,
  TRANSPARENT_COMPACTION_PASS,
  TRANSPARENT_FRONT_PASS,
  TRANSPARENT_OCCLUSION_PASS,
  TRANSPARENTS_PASS,
  VIEW_PRESENT_PASS,
  VISIBILITY_IDENTIFIERS_PASS,
  VISIBILITY_PRIMARY_PASS,
  VISIBILITY_SECONDARY_PASS,
  XRAY_PASS,
  SEE_THROUGH_BACKGROUND_PASS,
  FRAME_DIFFERENCE_PASS,
]

/** The declarations, as each label module files its own passes: the table reads these. */
const DECLARED = [...ENGINE_PASSES, ...MIPS_PASSES, ...DEFORMATION_PASSES]

test('the declarations and the labels the passes begin with are one to one', () => {
  const declared = DECLARED.map((pass) => pass.label).sort()
  assert.equal(new Set(BEGUN).size, BEGUN.length, 'no two passes share a label')
  assert.deepEqual(declared, [...BEGUN].sort(), 'each label is declared once, and nothing else')
  for (const label of BEGUN) assert.ok(passRowOf(label), `${label}: the table files its pass`)
})

test('every declaration files its pass on a stage the engine profiles, at its index', () => {
  for (const { label, stage, block } of DECLARED)
    assert.deepEqual(passRowOf(label), { stage, at: WEBGPU_STAGES.indexOf(stage), block }, label)
  assert.ok(DECLARED.every(({ stage }) => WEBGPU_STAGES.includes(stage)))
})

test('the virtual shadow maps are one declared family, which no declared label repeats', () => {
  assert.equal(passRowOf(`${VSM_PASS_PREFIX}render.cull 3`)?.stage, 'shadows')
  assert.equal(passRowOf(`${VSM_PASS_PREFIX}render.cull 3`)?.block, 'other')
  assert.deepEqual(
    DECLARED.filter(({ label }) => label.startsWith(VSM_PASS_PREFIX)),
    [],
  )
  assert.deepEqual(
    DECLARED.filter(({ stage }) => stage === 'shadows'),
    [],
    'the family is the one rule: no declared pass joins the Shadows stage',
  )
})

test('a label no declaration names has no row', () => {
  assert.equal(passRowOf('beginComputePass'), undefined)
  assert.equal(passRowOf('Trillion3D pass invented tomorrow'), undefined)
})
