import { createRecordTexture } from '../core/recordTexture.ts'
import type { RecordLayout } from '../core/recordLayout.ts'
import { recordTextureWgsl, type RecordBinding } from '../core/recordTextureWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TREE_SPAN, treeNodeCount, type PlacementTree } from './placementTree.ts'
import { writeRanges } from './runWrites.ts'
import { mirroredWords, takeMirrored } from '../../webgpu/cut/denseKeys.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import { NODE_MAX, NODE_MIN } from './nodeLayout.ts'

/**
 * THE PLACEMENT TREE'S HOME, one whatever the world's size: a record table
 * (`../core/recordTexture.ts`) of `r32uint` words, a record a node of the tree, its index within
 * the tree (`PlacementTree.nodes`) — `Node`, its twenty-four words laid as a `CullNode`
 * (`nodeLayout.ts`) —, and beside the nodes the tree's two lists, each one line of words across the
 * records (`TREE_SPAN` a record): `Members`, the order of its members (`PlacementTree.order`), and
 * `Always`, the members drawn whatever the view (`PlacementTree.always`). The tree holds at least a
 * node a group, so the lists fit beside the nodes.
 *
 * Every reader reads it in place — the culling's level loop (`shader/placementTreeWgsl.ts`), the
 * proxy's rays (`../../bounce/runtimeSceneWgsl.ts`), the ray query
 * (`../../webgpu/rays/rayQueryWgsl.ts`) —, the refit reads and writes its boxes in place
 * (`treeRefitWgsl.ts`, the WGSL feature `readonly_and_readwrite_storage_textures`), and the host
 * writes what a packing, a join or an append moved (`createTreeTable`). Copied by none.
 *
 * A row holds 32 nodes, 4864 words; a layer 8192 rows, 2¹⁸ nodes.
 */
export const TREE_TABLE: RecordLayout = {
  label: 'Trillion3D DAG placement tree',
  format: 'r32uint',
  fields: { Node: DAG_NODE_FLOATS, Members: TREE_SPAN, Always: TREE_SPAN },
  rowShift: 5,
  layerShift: 13,
}

/** The three words of node `n`'s box corner from word `k` of `name`'s table, as a vector. */
const corner = (name: string, k: number) =>
  `bitcast<vec3f>(vec3u(${name}Word(n,${k}u),${name}Word(n,${k + 1}u),${name}Word(n,${k + 2}u)))`

/**
 * The tree's table as a program binds it, named `name`: `<name>Word(n,k)`, word `k` of node `n`;
 * `<name>Low(n)` and `<name>High(n)`, the low and high corners of its world box (`nodeLayout.ts`),
 * the one corner reader of every walk; `<name>Member(k)`, member `k` of its order; `<name>AlwaysAt(j)`, the `j`-th member drawn whatever
 * the view — and, bound `read_write`, `<name>SetWord(n,k,v)`.
 */
export function treeTableWgsl(name: string, binding: Omit<RecordBinding, 'name'>) {
  const written = binding.access === 'read_write'
  return wgslBlock(
    `treeTable(${name}, ${binding.group}, ${binding.binding}, ${binding.access})`,
    [recordTextureWgsl(TREE_TABLE, { name, ...binding })],
    `fn ${name}Word(n:u32,k:u32)->u32{return ${name}Node(n,k).x;}
fn ${name}Low(n:u32)->vec3f{return ${corner(name, NODE_MIN)};}
fn ${name}High(n:u32)->vec3f{return ${corner(name, NODE_MAX)};}
fn ${name}Member(k:u32)->u32{return ${name}Members(k/${TREE_SPAN}u,k%${TREE_SPAN}u).x;}
fn ${name}AlwaysAt(j:u32)->u32{return ${name}Always(j/${TREE_SPAN}u,j%${TREE_SPAN}u).x;}
${written ? `fn ${name}SetWord(n:u32,k:u32,v:u32){${name}NodeStore(n,k,vec4u(v,0u,0u,0u));}` : ''}`,
  )
}

/**
 * The table of `tree` on `device` — a node's worth without one, which no program reads —, made by
 * `make` (a cut's admission, `resources.ts`) and written whole: the nodes as the packing laid them,
 * the order, the members drawn whatever the view. Then the host's writes of what moved.
 */
export function createTreeTable(
  device: GPUDevice,
  tree: PlacementTree | undefined,
  make?: (descriptor: GPUTextureDescriptor, bytes: number) => GPUTexture,
) {
  // Sampled by the culling and the rays, written by the host and by the refit's storage binding.
  const usage =
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING
  const table = createRecordTexture(
    device,
    TREE_TABLE,
    Math.max(1, treeNodeCount(tree)),
    usage,
    make,
  )
  const nodeTarget = table.target('Node'),
    alwaysTarget = table.target('Always')
  if (tree) {
    table.write(
      'Node',
      0,
      treeNodeCount(tree),
      tree.nodes.buffer as ArrayBuffer,
      tree.nodes.byteOffset,
    )
    const { order } = tree
    table.writeTexels('Members', 0, order.length, order.buffer as ArrayBuffer, order.byteOffset)
    const always = mirroredWords(tree.always)
    table.writeTexels(
      'Always',
      0,
      tree.always.set.count,
      always.buffer as ArrayBuffer,
      always.byteOffset,
    )
  }
  return {
    view: table.view,
    bytes: table.bytes,
    texture: table.texture,
    /** The nodes `ids` names, increasing, as the tree holds them: a join's (`joinPlacementTree`). */
    writeNodes(ids: Int32Array) {
      if (!tree || !ids.length) return
      const source = { data: tree.nodes, sourceBase: 0, targetBase: 0, stride: DAG_NODE_FLOATS }
      writeRanges(nodeTarget, ids, ids.length, source)
    },
    /** Member slots `[from, to)` of the tree's order. */
    writeMembers(from: number, to: number) {
      if (!tree || to <= from) return
      const { order } = tree
      table.writeTexels(
        'Members',
        from,
        to - from,
        order.buffer as ArrayBuffer,
        order.byteOffset + from * 4,
      )
    },
    /** The places of the list of members drawn whatever the view that moved since the last write
     *  (`takeMirrored`). */
    writeAlways() {
      if (!tree?.always.moves.count) return
      const moved = takeMirrored(tree.always),
        source = { data: mirroredWords(tree.always), sourceBase: 0, targetBase: 0, stride: 1 }
      writeRanges(alwaysTarget, moved, moved.length, source)
    },
    destroy: table.destroy,
  }
}
export type TreeTable = ReturnType<typeof createTreeTable>
