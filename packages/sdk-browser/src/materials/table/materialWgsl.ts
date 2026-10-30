import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { MATERIAL_RANK_MASK } from '../../visibility/types.ts'
import { PHYSICAL_MAP_FIELDS } from '../../visibility/materialType.ts'
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
/** WGSL of `name`, which reads the one word of field `field` of a row's or item's record. */
const wordOf = (name: string, field: 'lobes' | 'channels' | 'graph') => {
  const at = MATERIAL_RECORD.at[field]
  return `fn ${name}(word:u32)->u32{
 return materialTableRecord(word&${MATERIAL_RANK_MASK}u,${at >> 2}u).${LANES[at & 3]};
}`
}
const TEXELS = Array.from(
  { length: MATERIAL_RECORD_TEXELS },
  (_, i) => `let t${i}=materialTableRecord(r,${i}u);`,
).join('')

/**
 * THE MATERIAL TABLE as a pass reads it (`materialTable.ts`): bound at `binding` of `group` as the engine binds
 * every record table (`recordTextureWgsl`, a `2d-array` view), a surface's record
 * read whole by its row's or item's word (`materialAt`, `MATERIAL_RANK_MASK` below the second UV
 * set's bit) — each of its eleven texels a `textureLoad`, those a pass never reads left to the
 * compiler —, its lobe word and its maps' UV channels word alone (`materialLobesOf`,
 * `materialChannelsOf`), and the lobe extension that word names
 * (`physicalAt`): the very words the table holds.
 */
export const materialTableWgsl = (binding: number, group = 0) =>
  wgslBlock(
    group === 0 ? `materialTableWgsl(${binding})` : `materialTableWgsl(${binding}, ${group})`,
    [
      recordTextureWgsl(MATERIAL_TABLE, {
        name: 'materialTable',
        group,
        binding,
        access: 'read',
      }),
    ],
    `${MATERIAL_RECORD.wgsl}
struct PhysicalInfo{lobes:vec4f,coatNormalScale:vec2f,channels:u32,law:u32,sheen:vec4f,maps:array<u32,${PHYSICAL_MAP_FIELDS.length}>,specular:f32,}
fn materialAt(word:u32)->Material{
 let r=word&${MATERIAL_RANK_MASK}u;
 ${TEXELS}
 return Material(${FIELDS.join(',')});
}
${wordOf('materialLobesOf', 'lobes')}
${wordOf('materialChannelsOf', 'channels')}
${wordOf('materialGraphWord', 'graph')}
/** The header texel of the values the record's graph word \`word\` (not zero) names: the program's id,
 *  then the header bits (\`GRAPH_HEADER\`). */
fn materialGraphHead(word:u32)->vec4u{
 let first=word-1u;
 return materialTableRecord(first/${MATERIAL_RECORD_TEXELS}u,first%${MATERIAL_RECORD_TEXELS}u);
}
fn physicalAt(lobes:u32)->PhysicalInfo{
 let t=lobes-1u;
 let r=t/${MATERIAL_RECORD_TEXELS}u;let k=t%${MATERIAL_RECORD_TEXELS}u;
 let a=materialTableRecord(r,k);let b=materialTableRecord(r,k+1u);let m=materialTableRecord(r,k+3u);let e=materialTableRecord(r,k+4u);
 return PhysicalInfo(bitcast<vec4f>(a),bitcast<vec2f>(b.xy),b.z,b.w,bitcast<vec4f>(materialTableRecord(r,k+2u)),array<u32,${PHYSICAL_MAP_FIELDS.length}>(m.x,m.y,m.z,m.w,e.x,e.y,e.z),bitcast<f32>(e.w));
}`,
  )
