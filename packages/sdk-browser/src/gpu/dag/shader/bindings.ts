import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  namedEntries,
} from '../../core/computeBindings.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { recordTextureWgsl } from '../../core/recordTextureWgsl.ts'
import { worldTableWgsl } from '../worldTable.ts'
import { treeTableWgsl } from '../treeTable.ts'
import { frameTableWgsl } from '../frameTable.ts'
import { nodeTableWgsl } from '../nodeTable.ts'
import { CLUSTER_TABLE, COLD_TABLE, FLAG_TABLE } from '../cutTables.ts'

/** Group-0 binding of each table the selection kernel reads, under its WGSL name: its uniforms,
 *  the readout and `work` — two storage buffers, whatever the world —, and the record tables
 *  (`../cutTables.ts`, `../nodeTable.ts`, `../worldTable.ts`, `../frameTable.ts`,
 *  `../treeTable.ts`), the flags the one the kernels write. */
const DAG_BINDING = {
  clusters: 0,
  nodes: 1,
  views: 2,
  flags: 3,
  out: 4,
  work: 5,
  worlds: 6,
  frames: 7,
  cold: 8,
  tree: 9,
} as const

const B = DAG_BINDING

/** The bindings that are buffers; every other is a record table's view. */
const DAG_BUFFERS = { views: 'uniform', out: 'storage', work: 'storage' } as const
type DagBufferName = keyof typeof DAG_BUFFERS
type DagTableName = Exclude<keyof typeof DAG_BINDING, DagBufferName>

/** Group 0 of the selection kernel, each buffer and each record table's view at its WGSL name's
 *  binding (`../cameraFrames.ts`): the camera cut's and the dispatch bench's. */
export function dagGroupEntries(
  group: Record<DagBufferName, GPUBuffer> & Record<DagTableName, GPUTextureView>,
) {
  const { views, out, work, ...tables } = group
  return namedEntries(DAG_BINDING, {
    ...tables,
    views: { buffer: views },
    out: { buffer: out },
    work: { buffer: work },
  })
}

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
    nodeTableWgsl('nodes', { group: 0, binding: B.nodes }),
    recordTextureWgsl(FLAG_TABLE, {
      name: 'flags',
      group: 0,
      binding: B.flags,
      access: 'read_write',
    }),
    worldTableWgsl('worlds', { group: 0, binding: B.worlds, access: 'read' }),
    frameTableWgsl('frames', { group: 0, binding: B.frames, access: 'read' }),
    recordTextureWgsl(COLD_TABLE, { name: 'cold', group: 0, binding: B.cold, access: 'read' }),
    treeTableWgsl('tree', { group: 0, binding: B.tree, access: 'read' }),
  ],
  `@group(0) @binding(${B.views}) var<uniform> views:array<Uniforms,MAX_VIEWS>;
@group(0) @binding(${B.out}) var<storage, read_write> out:Output;
@group(0) @binding(${B.work}) var<storage, read_write> work:array<atomic<u32>>;
`,
)

/**
 * How the kernel reads its record tables: one accessor each, a record's texels loaded and read as
 * the struct the packing laid (`Cluster`, `CullNode`), a word of the cold words or of the flags;
 * no stage reads a table but through them.
 */
export const DAG_ACCESS_WGSL = wgslBlock(
  'DAG_ACCESS_WGSL',
  [DAG_BINDINGS_WGSL],
  `fn clusterAt(i:u32)->Cluster{
 let a=clustersCluster(i,0u);let b=clustersCluster(i,1u);let c=clustersCluster(i,2u);
 return Cluster(bitcast<vec4f>(a),bitcast<vec4f>(b),bitcast<f32>(c.x),bitcast<f32>(c.y),c.z);
}
fn nodeAt(i:u32)->CullNode{
 let a=nodesNode(i,0u);let b=nodesNode(i,1u);let c=nodesNode(i,2u);
 let d=nodesNode(i,3u);let e=nodesNode(i,4u);let f=nodesNode(i,5u);
 return CullNode(bitcast<vec3f>(a.xyz),a.w,bitcast<vec3f>(b.xyz),bitcast<f32>(b.w),bitcast<vec4f>(c),d.x,d.y,d.z,d.w,bitcast<vec4f>(e),bitcast<f32>(f.x),f.y,f.z,f.w);
}
fn coldAt(i:u32)->u32{return coldWord(i,0u).x;}
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
    return {
      binding,
      visibility: COMPUTE,
      storageTexture: { access: 'read-write', format: 'r32uint', viewDimension: '2d-array' },
    }
  })
}
