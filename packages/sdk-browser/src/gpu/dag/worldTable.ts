import type { RecordLayout } from '../core/recordLayout.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TRANSLATION_AT_EYE_WGSL } from './shader/worldPoseWgsl.ts'

/**
 * THE PLACEMENTS' RECORDS, one home whatever the world's size: a record table
 * (`../core/recordTexture.ts`), a placement a record of three fields — `Matrix`, its sixteen-word
 * world as the host writes it, four texels; `Origin`, its exact translation as three doubles, high
 * word then low word, as the GPU holds a double (`math/src/wgsl/double.ts`), and two words of
 * padding, two texels (`worldOrigins.ts`); and `Instance`, what the proxy's rays meet of it, four
 * words laid as `INSTANCE` says (`../../bounce/runtimeLayout.ts`), one texel —, then one record a
 * blended copy the proxy traces, its `Instance` alone (`proxyInstances.ts`). Every reader reads it
 * in place — the culling at its eye (`shader/worldPoseWgsl.ts`), the proxy's rays
 * (`../../bounce/runtimeSceneWgsl.ts`), the ray query at its origin
 * (`../../webgpu/rays/rayPlacementWgsl.ts`) —, written by the host (`cameraFrames.ts`,
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

/**
 * The records as a program in `group` binds them at `binding`, named `name`: `<name>Matrix(w,k)`,
 * `<name>Origin(w,k)`, `<name>Instance(w,0u)` where it reads them, `…Store(w,k,v)` where it writes
 * them. Where it reads them, the one reader of a placement's world: `<name>Linear(w)`, its linear
 * part, and `<name>WorldAtEye(w,e0,e1)`, its world with the translation at the eye `e0`, `e1` taken
 * from the exact one beside the matrix (`TRANSLATION_AT_EYE_WGSL`) — a cut at its view's eye, a ray
 * at its origin, the proxy at a zero eye, the single-precision value a host write holds. The
 * matrix is taken as floats, its words 12 to 14 never read.
 */
export function worldTableWgsl(name: string, binding: Omit<RecordBinding, 'name'>) {
  const table = recordTextureWgsl(WORLD_TABLE, { name, ...binding })
  if (binding.access === 'write') return table
  const column = (c: number) => `bitcast<vec4f>(${name}Matrix(w,${c}u))`
  return wgslBlock(
    `worldTable(${name}, ${binding.group}, ${binding.binding}, ${binding.access})`,
    [table, TRANSLATION_AT_EYE_WGSL],
    `fn ${name}Linear(w:u32)->mat3x3f{return mat3x3f(${column(0)}.xyz,${column(1)}.xyz,${column(2)}.xyz);}
fn ${name}WorldAtEye(w:u32,e0:vec4u,e1:vec4u)->mat4x4f{
 let t=bitcast<vec3f>(translationAtEye(${name}Origin(w,0u),${name}Origin(w,1u),e0,e1));
 return mat4x4f(${column(0)},${column(1)},${column(2)},vec4f(t,${column(3)}.w));
}`,
  )
}
