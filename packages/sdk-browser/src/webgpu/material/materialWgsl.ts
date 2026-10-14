import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { MATERIAL_RANK_MASK } from '../../visibility/types.ts'
import { recordTextureWgsl } from '../../gpu/core/recordTextureWgsl.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_TEXELS, MATERIAL_TABLE } from './materialLayout.ts'

const LANES = 'xyzw'
/** The lanes of `count` words from word `at` of texel `t<at / 4>`. */
const lanes = (at: number, count: number) => `t${at >> 2}.${LANES.slice(at & 3, (at & 3) + count)}`
/** WGSL of field `type` read at word `at` of a record's texels `t0` to `t9`. */
const FIELD_READS: Record<string, (at: number) => string> = {
  f32: (at) => `bitcast<f32>(${lanes(at, 1)})`,
  u32: (at) => lanes(at, 1),
  vec2f: (at) => `bitcast<vec2f>(${lanes(at, 2)})`,
  vec3f: (at) => `bitcast<vec3f>(${lanes(at, 3)})`,
}
/** The record's fields, each read off its texels: made of its one table (`MATERIAL_RECORD`). */
const FIELDS = MATERIAL_RECORD.wgsl
  .slice(MATERIAL_RECORD.wgsl.indexOf('{') + 1, -1)
  .split(',')
  .filter(Boolean)
  .map((field) => {
    const [name, type] = field.split(':')
    return FIELD_READS[type](MATERIAL_RECORD.at[name as keyof typeof MATERIAL_RECORD.at])
  })
const TEXELS = Array.from(
  { length: MATERIAL_RECORD_TEXELS },
  (_, i) => `let t${i}=materialTableRecord(r,${i}u);`,
).join('')

/**
 * THE MATERIAL TABLE as a pass reads it (`materialTable.ts`): bound at `binding` as the engine binds
 * every record table (`recordTextureWgsl`, a `2d-array` view), a surface's record
 * read whole by its row's or item's word (`materialAt`, `MATERIAL_RANK_MASK` below the second UV
 * set's bit) — each of its ten texels a `textureLoad`, those a pass never reads left to the
 * compiler —, its lobe word alone (`materialLobesOf`), and the lobe extension that word names
 * (`physicalAt`): the very words the table holds.
 */
export const materialTableWgsl = (binding: number) =>
  wgslBlock(
    `materialTableWgsl(${binding})`,
    [
      recordTextureWgsl(MATERIAL_TABLE, {
        name: 'materialTable',
        group: 0,
        binding,
        access: 'read',
      }),
    ],
    `${MATERIAL_RECORD.wgsl}
struct PhysicalInfo{lobes:vec4f,coatNormalScale:vec2f,channels:u32,pad:u32,maps:vec4u,}
fn materialAt(word:u32)->Material{
 let r=word&${MATERIAL_RANK_MASK}u;
 ${TEXELS}
 return Material(${FIELDS.join(',')});
}
fn materialLobesOf(word:u32)->u32{
 return materialTableRecord(word&${MATERIAL_RANK_MASK}u,${MATERIAL_RECORD.at.lobes >> 2}u).${LANES[MATERIAL_RECORD.at.lobes & 3]};
}
fn physicalAt(lobes:u32)->PhysicalInfo{
 let t=lobes-1u;
 let r=t/${MATERIAL_RECORD_TEXELS}u;let k=t%${MATERIAL_RECORD_TEXELS}u;
 let a=materialTableRecord(r,k);let b=materialTableRecord(r,k+1u);
 return PhysicalInfo(bitcast<vec4f>(a),bitcast<vec2f>(b.xy),b.z,b.w,materialTableRecord(r,k+2u));
}`,
  )
