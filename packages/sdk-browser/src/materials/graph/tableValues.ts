import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { materialTableWgsl } from '../table/materialWgsl.ts'
import { MATERIAL_RECORD_TEXELS } from '../table/materialLayout.ts'
import type { CompiledGraph } from './compile.ts'

/** The texel `t` of the table's texels, eleven to a record's place: the first of a graph's values
 *  and those after it (`../table/graphRecord.ts`). */
const texelOf = (suffix: string) => `mgTexel${suffix}`

/**
 * The function that reads the values of the graph `g` from the material table bound at `binding` of `group`
 * (`mgLoad`, with the graph's suffix): its vectors, then its texture words, after the header texel
 * the surface's record names (`graph` less one). The values a surface writes beside its record
 * (`../table/graphRecord.ts`) are read by the pass that shades it, with no binding of its own.
 */
export const graphLoadWgsl = (g: CompiledGraph, binding: number, group = 0) => {
  const vectors = Math.max(g.slots.vectors.length, 1)
  return wgslBlock(
    `materialGraphLoad(${g.hash}${g.suffix},${binding}${group === 0 ? '' : `,${group}`})`,
    [g.wgsl, materialTableWgsl(binding, group)],
    `fn ${texelOf(g.suffix)}(t:u32)->vec4u{return materialTableRecord(t/${MATERIAL_RECORD_TEXELS}u,t%${MATERIAL_RECORD_TEXELS}u);}
fn mgLoad${g.suffix}(first:u32)->${g.values}{
 var g:${g.values};
 for(var i=0u;i<${vectors}u;i++){g.v[i]=bitcast<vec4f>(${texelOf(g.suffix)}(first+1u+i));}
 for(var i=0u;i<${g.slots.textureRows}u;i++){g.t[i]=${texelOf(g.suffix)}(first+1u+${vectors}u+i);}
 return g;
}`,
  )
}
