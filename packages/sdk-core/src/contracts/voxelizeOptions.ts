/**
 * A compile job's voxelized objects as a host names them, and the function that turns them into
 * the form the compiler reads (`args/voxelize.rs`). A mesh is voxelized far away — its
 * DAG's coarse levels bricks of voxels wherever they hold the error better than triangles, a leaf
 * card's cut-out kept —, the first source naming it winning:
 * 1. `voxelize` — a match on the objects, as `responsive` names them: the meshes of every object
 *    it matches;
 * 2. the HLOD: the meshes of every object whose layer's chain has a `voxel` layer (the expert
 *    form's layers, `hlodOptions.ts`);
 * 3. the mesh's own `extras.shapePreservation: "voxelize"` in the glTF (`VOXELIZE_EXTRA`).
 * A job naming none of them compiles as before. A value left out or `null` names nothing, as the
 * compiler reads it.
 */
import { VOXELIZE_FIELD, VOXELIZE_OPTION } from './compilerAbi.ts'
import { jsonJobOption, matchResolver, type NameMatch, type NamePattern } from './nameMatch.ts'

/** The objects whose meshes are voxelized far away: a node's name (a string, exact), a regular
 *  expression on it, or a match on what the glTF carries (`NameMatch`). */
export type VoxelizeOption = NamePattern | NameMatch

/**
 * The voxelize match the compiler reads for `option`: none when left out.
 * @param option - The objects, by name or by match, or none.
 * @returns The compiler's form (`HlodWireMatch`), `undefined` for none.
 * @throws TypeError naming what the host wrote wrong.
 */
export const resolveVoxelize = matchResolver<VoxelizeOption>('voxelize')

/** A job's `voxelize` as the job field and the command line's flag the compiler reads
 *  (`jsonJobOption`): `fields` left out, `flags` none, when the job names none. */
export const voxelizeJob = jsonJobOption(VOXELIZE_FIELD, VOXELIZE_OPTION, resolveVoxelize)
