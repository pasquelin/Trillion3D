import {
  BLOOM_PASS,
  BOUNCE_PASS,
  DEFERRED_LIGHTING_PASS,
  HIZ_PASS,
  IMPOSTOR_PASS,
  LIGHT_TILES_PASS,
  MATERIAL_COMPUTE_PASS,
  MATERIAL_SURFACES_PASS,
  PARTICLES_PASS,
  PARTITION_PASS,
  PARTICLE_DRAW_PASS,
  TAA_PASS,
} from './passLabels.ts'
import { WATER_COMPOSITE_PASS, WATER_SURFACE_PASS } from '../webgpu/water/passLabels.ts'
import {
  REFLECTION_BOUNDS_MIPS_PASS,
  REFLECTION_RADIANCE_MIPS_PASS,
  TEXTURE_MIPS_PASS,
} from '../texture/mipsPass.ts'
import { REFLECTION_SOURCE_PASS } from '../reflections/sourcePass.ts'
import { DEFORMATION_PASS } from '../deformation/pass.ts'

/**
 * The two blocks of a frame that can be set against a published profile, and nothing else.
 * `visibility` is building the visibility buffer: selection, partition, Hi-Z and raster.
 * `materials` is writing surfaces from that buffer. Everything else is `other`: shadows, light
 * lists, bounce, transparents, deferred lighting and present — putting any of those in a block
 * would inflate a comparison instead of serving it, so they stay outside AND named, each pass
 * keeping its duration.
 */
export type GpuPassBlock = 'visibility' | 'materials' | 'other'

/** A shadow page's GPU cost: choosing its casters, then drawing them. Sampling is in `lighting`. */
type ShadowPart = 'cull' | 'raster'

/** A pass's row: its stage and block, plus its shadow part when it serves shadow pages. */
export type PassRow = readonly [stage: string, block: GpuPassBlock, part?: ShadowPart]

/**
 * Profile stage, comparison block and shadow part of each GPU pass, read from the label the pass
 * already carries. This is the only read of deposit labels: direct-light durations, the per-stage
 * profile and the blocks share it. Every pass the engine begins is named here
 * (`../gpu/timing/passLabels.test.ts` reads each label from the source): a label the table does
 * not name joins no stage and the block `other`, so it never swells a stage or a compared block.
 * The labels come from the label modules the passes read their own from (`passLabels.ts` and its
 * siblings), or are the pass's own words: an import of the passes would put them and their
 * shaders in the CDN core, ahead of the renderer's own chunk, which the page downloads beside the
 * scene (#1353).
 */
export const PASSES: Readonly<Record<string, PassRow>> = Object.freeze({
  [DEFORMATION_PASS]: ['animations', 'other'],
  'Trillion3D compose roots': ['animations', 'other'],
  'Trillion3D DAG selection': ['selection', 'visibility'],
  'Trillion3D DAG mask swap': ['selection', 'visibility'],
  [PARTITION_PASS]: ['partition', 'visibility'],
  [HIZ_PASS]: ['hiZ', 'visibility'],
  'Trillion3D clear': ['geometry', 'visibility'],
  'Trillion3D visibility primary': ['geometry', 'visibility'],
  'Trillion3D visibility secondary': ['geometry', 'visibility'],
  'Trillion3D small triangle binning': ['geometry', 'visibility'],
  'Trillion3D small triangle raster': ['geometry', 'visibility'],
  'Trillion3D hybrid visibility resolve': ['geometry', 'visibility'],
  // Compute raster (`../gpu/raster/raster.ts`, `../gpu/raster/resolve.ts`): it builds the same buffer.
  'Trillion3D raster target and lists': ['geometry', 'visibility'],
  'Trillion3D raster dispatch': ['geometry', 'visibility'],
  'Trillion3D raster binning': ['geometry', 'visibility'],
  'Trillion3D raster occluder depth': ['geometry', 'visibility'],
  'Trillion3D raster tested depth': ['geometry', 'visibility'],
  'Trillion3D raster identifiers': ['geometry', 'visibility'],
  'Trillion3D raster occluder hiz': ['hiZ', 'visibility'],
  'Trillion3D raster resolve': ['geometry', 'visibility'],
  [`${IMPOSTOR_PASS} visibility`]: ['geometry', 'visibility'],
  'Trillion3D empty surfaces': ['geometry', 'materials'],
  [MATERIAL_COMPUTE_PASS]: ['geometry', 'materials'],
  [MATERIAL_SURFACES_PASS]: ['geometry', 'materials'],
  [IMPOSTOR_PASS]: ['geometry', 'materials'],
  [TEXTURE_MIPS_PASS]: ['textures', 'other'],
  'Trillion3D texture feedback reduce': ['textures', 'other'],
  'Trillion3D texel turn': ['textures', 'other'],
  'Trillion3D transparents': ['transparents', 'other'],
  'Trillion3D transmission': ['transparents', 'other'],
  [WATER_SURFACE_PASS]: ['transparents', 'other'],
  [WATER_COMPOSITE_PASS]: ['transparents', 'other'],
  'Trillion3D transparent compaction': ['transparents', 'other'],
  'Trillion3D transparent occlusion': ['transparents', 'other'],
  'Trillion3D blend order and expansion': ['transparents', 'other'],
  'Trillion3D display mask': ['transparents', 'other'],
  'Trillion3D display filter': ['transparents', 'other'],
  [PARTICLE_DRAW_PASS]: ['transparents', 'other'],
  'Trillion3D shadow cull': ['shadows', 'other', 'cull'],
  'Trillion3D shadow page pyramids': ['shadows', 'other', 'cull'],
  'Trillion3D shadow occlusion': ['shadows', 'other', 'cull'],
  [LIGHT_TILES_PASS]: ['lightLists', 'other'],
  [BOUNCE_PASS]: ['bounce', 'other'],
  'Trillion3D bounce probe level clear': ['bounce', 'other'],
  [REFLECTION_SOURCE_PASS]: ['reflections', 'other'],
  [REFLECTION_RADIANCE_MIPS_PASS]: ['reflections', 'other'],
  [REFLECTION_BOUNDS_MIPS_PASS]: ['reflections', 'other'],
  'Trillion3D rough reflection trace': ['reflections', 'other'],
  'Trillion3D reflection history resolve': ['reflections', 'other'],
  [PARTICLES_PASS]: ['physics', 'other'],
  [DEFERRED_LIGHTING_PASS]: ['lighting', 'other'],
  'Trillion3D as-is share seed': ['antialiasing', 'other'],
  [TAA_PASS]: ['antialiasing', 'other'],
  [BLOOM_PASS]: ['effects', 'other'],
  'Trillion3D HDR composition': ['present', 'other'],
  'Trillion3D HDR composition + present': ['present', 'other'],
  'Trillion3D direct present': ['present', 'other'],
  'Trillion3D view present': ['present', 'other'],
  'Trillion3D guides': ['present', 'other'],
  'Trillion3D explicit capture': ['present', 'other'],
  'Trillion3D capture emission and occlusion': ['present', 'other'],
})

/** Shadow part of a pass, by its label. A pass that serves no shadow page is `other`. */
export const gpuShadowPartOf = (name: string) => PASSES[name]?.[2] ?? 'other'
