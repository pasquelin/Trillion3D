import type { RecordLayout } from '../core/recordLayout.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import { nodeCornersWgsl } from './nodeLayout.ts'

/**
 * THE CUT'S NODES, one home whatever the world's size: a record table (`../core/recordTexture.ts`)
 * of `rgba32uint`, a node a record of one field — `Node`, its twenty-four words as the packing lays
 * them (`packNodes.ts`, `nodeLayout.ts`), six texels, one load each. Every reader reads it in place
 * — the cut's descent (`shader/bindings.ts`, `nodeAt`), the placement tree's leaves
 * (`../../placement/treeLeavesWgsl.ts`) —, written whole by the host (`cutTables.ts`,
 * `runtimeOps.ts`). Copied by none.
 *
 * A row holds 1024 nodes, 6144 texels; a layer 1024 rows, 2²⁰ nodes; 256 layers 2²⁸.
 */
export const NODE_TABLE: RecordLayout = {
  label: 'Trillion3D DAG nodes',
  format: 'rgba32uint',
  fields: { Node: DAG_NODE_FLOATS / 4 },
  rowShift: 10,
  layerShift: 10,
}

/** The nodes as a program binds them, read, named `name`: `<name>Node(i,t)`, texel `t` of node
 *  `i`, `<name>Word(i,k)`, its word `k`, and `<name>Low(n)`, `<name>High(n)`, its box's corners
 *  (`nodeCornersWgsl`). */
export const nodeTableWgsl = (name: string, binding: Omit<RecordBinding, 'name' | 'access'>) =>
  wgslBlock(
    `nodeTable(${name}, ${binding.group}, ${binding.binding})`,
    [recordTextureWgsl(NODE_TABLE, { name, ...binding, access: 'read' })],
    `fn ${name}Word(i:u32,k:u32)->u32{return ${name}Node(i,k>>2u)[k&3u];}
${nodeCornersWgsl(name)}`,
  )
