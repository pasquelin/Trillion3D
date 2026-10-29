import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  namedEntries,
} from '../../../gpu/core/computeBindings.ts'
import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { recordTextureWgsl } from '../../../gpu/core/recordTextureWgsl.ts'
import { resourceEntry } from '../../../gpu/bind/liveEntries.ts'
import { worldTableWgsl } from '../worlds/worldTable.ts'
import { treeTableWgsl } from '../tree/treeTable.ts'
import { frameTableWgsl } from '../frameTable.ts'
import { nodeTableWgsl } from '../nodeTable.ts'
import { CLUSTER_TABLE, COLD_TABLE, FLAG_TABLE } from '../cut/cutTables.ts'

/** Group-0 binding of each table the selection kernel reads, under its WGSL name: its uniforms,
 *  the readout, `work`, the list of visible clusters it writes (`../visible/layout.ts`) and the
 *  clusters' records and measured edges it reads (`../info/clusterInfoLayout.ts`) — five storage
 *  buffers, whatever the world —, and the record tables
 *  (`../cut/cutTables.ts`, `../nodeTable.ts`, `../worlds/worldTable.ts`, `../frameTable.ts`,
 *  `../tree/treeTable.ts`, the poses the previous image drew, `../previousPoses.ts`), the flags the
 *  one the kernels write. */
export const DAG_BINDING = {
  clusters: 0,
  nodes: 1,
  cutView: 2,
  flags: 3,
  out: 4,
  work: 5,
  worlds: 6,
  frames: 7,
  cold: 8,
  tree: 9,
  previous: 10,
  visible: 11,
  info: 12,
  edges: 13,
} as const

const B = DAG_BINDING

/** The bindings that are buffers; every other is a record table's view. */
const DAG_BUFFERS = {
  cutView: 'uniform',
  out: 'storage',
  work: 'storage',
  visible: 'storage',
  info: 'read-only-storage',
  edges: 'read-only-storage',
} as const
type DagBufferName = keyof typeof DAG_BUFFERS
type DagTableName = Exclude<keyof typeof DAG_BINDING, DagBufferName>

/** Group 0 of the selection kernel, each buffer and each record table's view at its WGSL name's
 *  binding (`../cameraFrames.ts`): the camera cut's and the dispatch bench's. */
export function dagGroupEntries(
  group: Record<DagBufferName, GPUBuffer> & Record<DagTableName, GPUTextureView>,
) {
  const { cutView, out, work, visible, info, edges, ...tables } = group
  return namedEntries(DAG_BINDING, {
    ...tables,
    cutView: { buffer: cutView },
    out: { buffer: out },
    work: { buffer: work },
    visible: { buffer: visible },
    info: { buffer: info },
    edges: { buffer: edges },
  })
}

/** Group 0 of the selection kernel as the descents of the view and of the cards bind it: the tables, the uniform, the flags, the readout and the work
 *  (the clusters, the visible lists, the information and the edges are bound by the one that has them). */
export const dagDescentEntries = (
  d: { uniform: GPUBuffer; flags: GPUTextureView; out: GPUBuffer; work: GPUBuffer },
  tables: Record<'nodes' | 'worlds' | 'frames' | 'cold' | 'tree' | 'previous', GPUTextureView>,
) =>
  namedEntries(DAG_BINDING, {
    nodes: tables.nodes,
    cutView: { buffer: d.uniform },
    flags: d.flags,
    out: { buffer: d.out },
    work: { buffer: d.work },
    worlds: tables.worlds,
    frames: tables.frames,
    cold: tables.cold,
    tree: tables.tree,
    previous: tables.previous,
  })

/** The cut's tables a pass beside it reads where they lie (`../../../lighting/rays/rayQueryWgsl.ts`):
 *  the nodes, the placements' frame words and records, and the placement tree. */
const READ_TABLES = ['nodes', 'frames', 'worlds', 'tree'] as const
export type DagReadTables = Record<(typeof READ_TABLES)[number], GPUTextureView>

/** Their declarations, in group 0 at the culling's bindings and under its names: one text the
 *  culling and a pass beside it both list. */
export const DAG_READ_TABLES_WGSL = wgslBlock(
  'DAG_READ_TABLES_WGSL',
  [
    nodeTableWgsl('nodes', { group: 0, binding: B.nodes }),
    worldTableWgsl('worlds', { group: 0, binding: B.worlds, access: 'read' }),
    frameTableWgsl('frames', { group: 0, binding: B.frames, access: 'read' }),
    treeTableWgsl('tree', { group: 0, binding: B.tree, access: 'read' }),
  ],
  '',
)

/** Their entries, each at the binding the culling reads it at (`DAG_READ_TABLES_WGSL`), read live
 *  from `tables` (`../../../gpu/bind/liveEntries.ts`): made once, the tables named each time. */
export const dagReadEntries = (tables: () => DagReadTables) =>
  READ_TABLES.map((name) => resourceEntry(DAG_BINDING[name], () => tables()[name]))

/** The same entries for a pass that makes its bind group at once: each table's view at the culling's binding. */
export const dagReadGroupEntries = (tables: DagReadTables): GPUBindGroupEntry[] =>
  READ_TABLES.map((name) => ({ binding: DAG_BINDING[name], resource: tables[name] }))

/** The layout entries of those tables (`DAG_READ_TABLES_WGSL`), each at the culling's binding: what a
 *  pass beside the cut that lists them declares in its group 0. */
export const dagReadLayoutEntries = () =>
  dagBindEntries().filter(({ binding }) =>
    READ_TABLES.some((name) => DAG_BINDING[name] === binding),
  )

/** Group-0 declarations of the selection kernel; its table accessors are `DAG_ACCESS_WGSL`. */
export const DAG_BINDINGS_WGSL = wgslBlock(
  'DAG_BINDINGS_WGSL',
  [
    recordTextureWgsl(CLUSTER_TABLE, {
      name: 'clusters',
      group: 0,
      binding: B.clusters,
      access: 'read',
    }),
    DAG_READ_TABLES_WGSL,
    recordTextureWgsl(FLAG_TABLE, {
      name: 'flags',
      group: 0,
      binding: B.flags,
      access: 'read_write',
    }),
    recordTextureWgsl(COLD_TABLE, { name: 'cold', group: 0, binding: B.cold, access: 'read' }),
    worldTableWgsl('previous', { group: 0, binding: B.previous, access: 'read' }),
  ],
  `@group(0) @binding(${B.cutView}) var<uniform> cutView:Uniforms;
@group(0) @binding(${B.out}) var<storage, read_write> out:Output;
@group(0) @binding(${B.work}) var<storage, read_write> work:array<atomic<u32>>;
@group(0) @binding(${B.visible}) var<storage, read_write> visible:array<atomic<u32>>;
@group(0) @binding(${B.info}) var<storage, read> info:array<ClusterInfo>;
@group(0) @binding(${B.edges}) var<storage, read> edges:array<f32>;
`,
)

/** Cold word `i` (`COLD_TABLE`) of the table its host binds as `cold`: what the descent reads its
 *  residency and its world links from, and a pass beside it the world's switch
 *  (`worldGateWgsl.ts`). */
export const DAG_COLD_AT_WGSL = wgslFn(
  'coldAt',
  [],
  'fn coldAt(i:u32)->u32{return coldWord(i,0u).x;}',
)

/** The hot record `i` as the struct the packing laid (`Cluster`), read through `accessor`, the
 *  texel reader of the table that holds the clusters (`recordTextureWgsl`: its name and
 *  `Cluster`'s suffix, `clustersCluster` for a table bound as `clusters`). */
const clusterAtWgsl = (accessor: string) =>
  wgslFn(
    'clusterAt',
    [],
    `fn clusterAt(i:u32)->Cluster{
 let a=${accessor}(i,0u);let b=${accessor}(i,1u);let c=${accessor}(i,2u);
 return Cluster(bitcast<vec4f>(a),bitcast<vec4f>(b),bitcast<f32>(c.x),bitcast<f32>(c.y),c.z);
}`,
  )

/**
 * How the kernel reads its record tables: one accessor each, a record's texels loaded and read as
 * the struct the packing laid (`Cluster`, `CullNode`), a word of the cold words
 * (`DAG_COLD_AT_WGSL`) or of the flags; no stage reads a table but through them.
 */
export const DAG_ACCESS_WGSL = wgslBlock(
  'DAG_ACCESS_WGSL',
  [DAG_BINDINGS_WGSL, DAG_COLD_AT_WGSL, clusterAtWgsl('clustersCluster')],
  `fn nodeAt(i:u32)->CullNode{
 let a=nodesNode(i,0u);let b=nodesNode(i,1u);let c=nodesNode(i,2u);
 let d=nodesNode(i,3u);let e=nodesNode(i,4u);
 return CullNode(bitcast<vec3f>(a.xyz),a.w,bitcast<vec3f>(b.xyz),bitcast<f32>(b.w),bitcast<vec4f>(c),d.x,d.y,d.z,d.w,bitcast<f32>(e.x),e.y,e.z,e.w);
}
fn flagAt(i:u32)->u32{return flagsWord(i,0u).x;}
fn setFlag(i:u32,v:u32){flagsWordStore(i,0u,vec4u(v,0u,0u,0u));}`,
)

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * browser probes READ them here — none copies them, so none can lag behind the shader.
 */
export function dagBindEntries(): GPUBindGroupLayoutEntry[] {
  return Object.entries(DAG_BINDING).map(([name, binding]) => {
    if (name in DAG_BUFFERS) return computeBufferEntry(binding, DAG_BUFFERS[name as DagBufferName])
    if (name !== 'flags') return computeTextureEntry(binding, 'uint', '2d-array')
    return computeStorageTextureEntry(binding, FLAG_TABLE.format, 'read-write', '2d-array')
  })
}
