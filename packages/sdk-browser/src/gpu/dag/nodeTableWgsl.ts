import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { partName } from './shader/splitWgsl.ts'
import { DAG_BINDING, dagPartBindings, type DagPartTable } from './shader/bindings.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import type { DagParts } from './split.ts'

/** How a device lays the cut's node table out: the nodes a part holds, the parts. */
export type NodeTableLayout = { per: number; parts: number }

/** The node table whole: one part. */
export const WHOLE_NODES: NodeTableLayout = { per: Infinity, parts: 1 }

/** How the device lays the nodes out: the nodes a part holds, the parts — what a kernel reading
 *  them is made for (`nodeTableBlock`). */
export const nodeLayout = (nodeParts: DagParts): NodeTableLayout => ({
  per: nodeParts.bytes / (DAG_NODE_FLOATS * 4),
  parts: nodeParts.buffers.length,
})

/** Word `k` of node `i` of a table of equal parts, read through the part that holds it. */
function acrossParts({ per, parts }: NodeTableLayout) {
  const at = (part: number) => (part ? `(i-${part * per}u)` : 'i')
  const target = (part: number) => `${partName('nodes', part)}[${at(part)}*${DAG_NODE_FLOATS}u+k]`
  let read = ''
  for (let part = 0; part < parts - 1; part++)
    read += `if(i<${(part + 1) * per}u){return ${target(part)};}`
  return `${read}return ${target(parts - 1)};`
}

/** The cut's nodes as a pass in group `group` reads them — a placement's root box, which the
 *  composition carries (`../../placement/gpuComposeWgsl.ts`): `nodes` at the cut's binding and
 *  each further part at its own (`dagPartBindings`), `nodeWord` across them. Whole, one binding. */
export function nodeTableBlock(layout: NodeTableLayout, group: number) {
  const counts: Partial<Record<DagPartTable, number>> = { nodes: layout.parts },
    declare = (name: string, binding: number) =>
      `@group(${group}) @binding(${binding}) var<storage,read> ${name}:array<u32>;`
  return wgslBlock(
    `nodeTable(${layout.per}x${layout.parts} g${group})`,
    [],
    `${declare('nodes', DAG_BINDING.nodes)}
${dagPartBindings(counts)
  .map(({ name, binding }) => declare(name, binding))
  .join('\n')}
fn nodeWord(i:u32,k:u32)->u32{${acrossParts(layout)}}`,
  )
}
