// The GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and the profile files a span by that label alone (`../../stage/passTable.ts`).
// Every label a pass begins with is a constant of a label module, and every one of them is declared
// once, with its stage and block, in that module (`../../stage/passDeclaration.ts`); the virtual
// shadow maps' passes, whose labels carry their chunk, set or kernel, are one declared family.
import test from 'node:test'
import assert from 'node:assert/strict'
import { WEBGPU_STAGES } from '../../stage/passDeclaration.ts'
import { passRowOf } from '../../stage/passTable.ts'
import {
  AS_IS_SHARE_PASS,
  BLEND_ORDER_PASS,
  BLOOM_PASS,
  BOUNCE_PASS,
  BOUNCE_PROBE_CLEAR_PASS,
  CAPTURE_PASS,
  COMPOSE_ROOTS_PASS,
  COMPOSE_ROWS_PASS,
  DAG_MASK_SWAP_PASS,
  DAG_SELECTION_PASS,
  DEFERRED_LIGHTING_PASS,
  DIRECT_PRESENT_PASS,
  DISPLAY_FILTER_PASS,
  DISPLAY_MASK_PASS,
  EMPTY_SURFACES_PASS,
  ENGINE_PASSES,
  GUIDE_PASS,
  HDR_COMPOSITION_PASS,
  HDR_PRESENT_PASS,
  HIZ_PASS,
  IMPOSTOR_PASS,
  IMPOSTOR_VISIBILITY_PASS,
  LIGHT_TILES_PASS,
  MATERIAL_COMPUTE_PASS,
  MATERIAL_SURFACES_PASS,
  PARTICLE_DRAW_PASS,
  PARTICLES_PASS,
  PARTITION_PASS,
  RASTER_BINNING_PASS,
  RASTER_IDENTIFIERS_PASS,
  RASTER_OCCLUDER_DEPTH_PASS,
  RASTER_OCCLUDER_HIZ_PASS,
  RASTER_RESOLVE_PASS,
  RASTER_TESTED_DEPTH_PASS,
  REFLECTION_PASS,
  REFLECTION_RADIANCE_PASS,
  TAA_PASS,
  TEXEL_TURN_PASS,
  TEXTURE_FEEDBACK_REDUCE_PASS,
  TRANSMISSION_PASS,
  TRANSPARENT_COMPACTION_PASS,
  TRANSPARENT_OCCLUSION_PASS,
  TRANSPARENTS_PASS,
  VIEW_PRESENT_PASS,
  VISIBILITY_PRIMARY_PASS,
  VISIBILITY_SECONDARY_PASS,
  VSM_PASS_PREFIX,
} from '../../stage/passLabels.ts'
import {
  WATER_COMPOSITE_PASS,
  WATER_PASSES,
  WATER_SURFACE_PASS,
} from '../../webgpu/water/passLabels.ts'
import { MIPS_PASSES, TEXTURE_MIPS_PASS } from '../../texture/mipsPass.ts'
import { DEFORMATION_PASS, DEFORMATION_PASSES } from '../../deformation/pass.ts'

/** The labels the engine's passes begin with, as the passes import them. */
const BEGUN = [
  AS_IS_SHARE_PASS,
  BLEND_ORDER_PASS,
  BLOOM_PASS,
  BOUNCE_PASS,
  BOUNCE_PROBE_CLEAR_PASS,
  CAPTURE_PASS,
  COMPOSE_ROOTS_PASS,
  COMPOSE_ROWS_PASS,
  DAG_MASK_SWAP_PASS,
  DAG_SELECTION_PASS,
  DEFERRED_LIGHTING_PASS,
  DEFORMATION_PASS,
  DIRECT_PRESENT_PASS,
  DISPLAY_FILTER_PASS,
  DISPLAY_MASK_PASS,
  EMPTY_SURFACES_PASS,
  GUIDE_PASS,
  HDR_COMPOSITION_PASS,
  HDR_PRESENT_PASS,
  HIZ_PASS,
  IMPOSTOR_PASS,
  IMPOSTOR_VISIBILITY_PASS,
  LIGHT_TILES_PASS,
  MATERIAL_COMPUTE_PASS,
  MATERIAL_SURFACES_PASS,
  PARTICLE_DRAW_PASS,
  PARTICLES_PASS,
  PARTITION_PASS,
  RASTER_BINNING_PASS,
  RASTER_IDENTIFIERS_PASS,
  RASTER_OCCLUDER_DEPTH_PASS,
  RASTER_OCCLUDER_HIZ_PASS,
  RASTER_RESOLVE_PASS,
  RASTER_TESTED_DEPTH_PASS,
  REFLECTION_PASS,
  REFLECTION_RADIANCE_PASS,
  TAA_PASS,
  TEXEL_TURN_PASS,
  TEXTURE_FEEDBACK_REDUCE_PASS,
  TEXTURE_MIPS_PASS,
  TRANSMISSION_PASS,
  TRANSPARENT_COMPACTION_PASS,
  TRANSPARENT_OCCLUSION_PASS,
  TRANSPARENTS_PASS,
  VIEW_PRESENT_PASS,
  VISIBILITY_PRIMARY_PASS,
  VISIBILITY_SECONDARY_PASS,
  WATER_COMPOSITE_PASS,
  WATER_SURFACE_PASS,
]

/** The declarations, as each label module files its own passes: the table reads these. */
const DECLARED = [...ENGINE_PASSES, ...WATER_PASSES, ...MIPS_PASSES, ...DEFORMATION_PASSES]

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
