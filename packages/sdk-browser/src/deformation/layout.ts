/**
 * THE DEFORMATION RECORD (#357): what the GPU deformation stage reads of one placement each frame,
 * as floats in one block the page passes bind, one record per deformed placement. A row names its
 * record (`PageInfo.deform`, the record's first float plus one; zero, none), and the page fetch of
 * every pass — visibility, compute raster, shadow depth, resolve, transparent, temporal — moves
 * each vertex by it before anything else reads the vertex (`deformWgsl.ts`).
 *
 * Head, eight floats: the sources drawn this frame and the last one (`KIND_*`, as bits), the
 * joint, target and wave counts. Then, from `RECORD_HEAD`: the joint palette of this frame and of
 * the last, twelve floats a joint (`PALETTE_FLOATS`); the morph weights of this frame and of the
 * last, one a target; the placement's world matrix and its inverse, sixteen each, which the waves
 * are read through; and each wave's eight floats (`WAVE_FLOATS`).
 */
import { PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts';

export const KIND_SKIN = 1,
  KIND_MORPH = 2,
  KIND_WAVE = 4;
export const RECORD_HEAD = 8;
/** Floats of one wave: direction `x`, `z`, wave number, amplitude, lateral amplitude, this
 *  frame's phase, the last one's, and one unused. */
export const WAVE_FLOATS = 8;

/** Counts a record is laid out for. */
export type RecordShape = { joints: number; targets: number; waves: number };

/** Where each part of a record starts, from its first float. */
export function recordLayout({ joints, targets, waves }: RecordShape) {
  const palette = RECORD_HEAD,
    weights = palette + 2 * joints * PALETTE_FLOATS,
    world = weights + 2 * targets,
    wave = world + (waves ? 32 : 0);
  return { palette, weights, world, wave, floats: wave + waves * WAVE_FLOATS };
}
