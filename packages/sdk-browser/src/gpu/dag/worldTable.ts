import type { RecordLayout } from '../core/recordTexture.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'

/**
 * THE PLACEMENTS' RECORDS, one home whatever the world's size: a record table
 * (`../core/recordTexture.ts`), a placement a record of three fields — `Matrix`, its sixteen-word
 * world as the host writes it, four texels; `Origin`, its exact translation as three doubles, high
 * word then low word, as the GPU holds a double (`math/src/wgsl/double.ts`), and two words of
 * padding, two texels (`worldOrigins.ts`); and `Instance`, what the proxy's rays meet of it, four
 * words laid as `INSTANCE` says (`../../bounce/runtimeLayout.ts`), one texel —, then one record a
 * blended copy the proxy traces, its `Instance` alone (`proxyInstances.ts`). Every reader reads it
 * in place — the culling at its eye (`shader/worldPoseWgsl.ts`), the proxy's rays
 * (`../../bounce/runtimeSceneWgsl.ts`) —, written by the host (`frameRanges.ts`,
 * `proxyInstances.ts`) and by the composition of the poses a parent moves
 * (`../../placement/gpuComposeWgsl.ts`), and copied by none but its growth when the copies outgrow
 * it (`RecordTexture.hold`).
 *
 * A row holds 1024 records, 7168 texels; a layer 8192 rows, 2²³ records; 256 layers 2³¹.
 */
export const WORLD_TABLE: RecordLayout = {
  label: 'Trillion3D DAG worlds',
  format: 'rgba32uint',
  fields: { Matrix: 4, Origin: 2, Instance: 1 },
  rowShift: 10,
  layerShift: 13,
}

/** The records as a program in `group` binds them at `binding`, named `name`: `<name>Matrix(w,k)`,
 *  `<name>Origin(w,k)`, `<name>Instance(w,0u)` where it reads them, `…Store(w,k,v)` where it
 *  writes them. */
export const worldTableWgsl = (name: string, binding: Omit<RecordBinding, 'name'>) =>
  recordTextureWgsl(WORLD_TABLE, { name, ...binding })
