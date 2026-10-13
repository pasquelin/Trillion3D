import type { RecordLayout } from '../core/recordTexture.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'

/**
 * THE CULLING'S WORLDS, one home whatever the world's size: a record table
 * (`../core/recordTexture.ts`), a placement a record of two fields — `Matrix`, its sixteen-word
 * world as the host writes it, four texels, and `Origin`, its exact translation as three doubles,
 * high word then low word, as the GPU holds a double (`math/src/wgsl/double.ts`), and two words of
 * padding, two texels (`worldOrigins.ts`). Every reader reads it in place — the culling at its eye
 * (`shader/worldPoseWgsl.ts`), the placement tree's refit, the proxy's rays
 * (`../../bounce/runtimeSceneWgsl.ts`) —, written by the host (`frameRanges.ts`) and by the
 * composition of the poses a parent moves (`../../placement/gpuComposeWgsl.ts`), and copied by none.
 *
 * A row holds 1024 placements, 6144 texels; a layer 8192 rows, 2²³ placements; 256 layers 2³¹.
 */
export const WORLD_TABLE: RecordLayout = {
  label: 'Trillion3D DAG worlds',
  format: 'rgba32uint',
  fields: { Matrix: 4, Origin: 2 },
  rowShift: 10,
  layerShift: 13,
}

/** The worlds as a program in `group` binds them at `binding`, named `name`: `<name>Matrix(w,k)`,
 *  `<name>Origin(w,k)` where it reads them, `…Store(w,k,v)` where it writes them. */
export const worldTableWgsl = (name: string, binding: Omit<RecordBinding, 'name'>) =>
  recordTextureWgsl(WORLD_TABLE, { name, ...binding })
