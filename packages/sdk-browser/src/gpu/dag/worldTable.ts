import type { RecordLayout } from '../core/recordLayout.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { toF32 } from '../../../../math/src/wgsl/f32.ts'

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
 * them. Where it reads them, the readers of a placement's world: `<name>Column(w,c)`, column `c` of
 * its matrix taken as floats (its words 12 to 14 never read); `<name>Linear(w)`, its linear part;
 * `<name>Translation(w)`, the exact translation beside the matrix rounded once to the
 * single-precision value a host write holds. The world at an eye, which subtracts it in double, is
 * `worldAtEyeWgsl` (`shader/worldPoseWgsl.ts`), listed only by the programs that take an eye.
 */
export function worldTableWgsl(name: string, binding: Omit<RecordBinding, 'name'>) {
  const table = recordTextureWgsl(WORLD_TABLE, { name, ...binding })
  if (binding.access === 'write') return table
  const column = (c: number) => `${name}Column(w,${c}u)`
  return wgslBlock(
    `worldTable(${name}, ${binding.group}, ${binding.binding}, ${binding.access})`,
    [table, toF32],
    `fn ${name}Column(w:u32,c:u32)->vec4f{return bitcast<vec4f>(${name}Matrix(w,c));}
fn ${name}Linear(w:u32)->mat3x3f{return mat3x3f(${column(0)}.xyz,${column(1)}.xyz,${column(2)}.xyz);}
fn ${name}Translation(w:u32)->vec3f{
 let o0=${name}Origin(w,0u);
 let o1=${name}Origin(w,1u);
 return bitcast<vec3f>(vec3u(toF32(o0.xy),toF32(o0.zw),toF32(o1.xy)));
}`,
  )
}
