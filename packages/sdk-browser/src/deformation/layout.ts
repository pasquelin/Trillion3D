/**
 * THE DEFORMATION RECORD: what the GPU deformation stage reads of one placement each frame,
 * as floats in one block the page passes bind, one record per deformed placement and one per track
 * of the animation banks, whose two palettes the bank pass writes (`bankTracks.ts`). A row names its
 * record (`PageInfo.deform`, the record's first float plus one; zero, none), and the page fetch of
 * every pass — visibility, compute raster, shadow depth, resolve, transparent, temporal — moves
 * each vertex by it before anything else reads the vertex (`deformWgsl.ts`).
 *
 * Head, eight floats: the sources drawn this frame and the last one (`KIND_*`, as bits), the
 * joint, target and wave counts. Then, from `RECORD_HEAD`: the joint palette of this frame and of
 * the last, twelve floats a joint (`PALETTE_FLOATS`); the morph weights of this frame and of the
 * last, one a target; current and previous world/inverse matrices, sixteen each, which the waves
 * are read through; then current and previous blocks of floats per wave (`WAVE_FLOATS`).
 */
import { PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts'
import { WAVE_FIELDS } from '../../../sdk-core/src/fluids/waves.ts'
import { alignUp } from '../../../math/src/scalar/integers.ts'
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'

export const KIND_SKIN = 1,
  KIND_MORPH = 2,
  KIND_WAVE = 4,
  KIND_SOFT = 8
export const RECORD_HEAD = 8
/** Words of the head: this frame's sources and the last one's (`KIND_*`), the joint, target, wave
 *  and soft counts, in this order, and the version of the soft source written. */
export const RECORD_WORD = {
  kinds: 0,
  previousKinds: 1,
  joints: 2,
  targets: 3,
  waves: 4,
  soft: 5,
  softVersion: 6,
} as const
/** Floats of the world block, from `world`: this frame's matrix, its inverse, then the last
 *  frame's two (`previous`), sixteen each. */
export const WORLD_BLOCK = {
  inverse: MATRIX_VALUES,
  previous: 2 * MATRIX_VALUES,
  floats: 4 * MATRIX_VALUES,
} as const
/** Floats of a soft source's node: its point this frame, the last one, at rest, its normal. */
const SOFT_FLOATS = 4 * 3
/** Floats of one wave: its `WAVE_FIELDS`, padded to a multiple of four. */
export const WAVE_FLOATS = alignUp(WAVE_FIELDS.length, 4)

/** Counts a record is laid out for. */
export type RecordShape = { joints: number; targets: number; waves: number; soft?: number }

/** Where each part of a record starts, from its first float. */
export function recordLayout({ joints, targets, waves, soft = 0 }: RecordShape) {
  const palette = RECORD_HEAD,
    weights = palette + 2 * joints * PALETTE_FLOATS,
    world = weights + 2 * targets,
    wave = world + (waves ? WORLD_BLOCK.floats : 0)
  const simulation = wave + 2 * waves * WAVE_FLOATS
  return { palette, weights, world, wave, simulation, floats: simulation + soft * SOFT_FLOATS }
}

/** The `n` floats of this frame from `at` copied to the last frame's place beside them, `at + n`:
 *  each block's "previous copy", before this frame's write, or after it on a cold write. */
export const keepPrevious = (block: Float32Array, at: number, n: number) =>
  block.copyWithin(at + n, at, at + n)
