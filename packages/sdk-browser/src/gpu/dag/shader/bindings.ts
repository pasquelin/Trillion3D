import { COMPUTE, namedBufferEntries } from '../../core/computeBindings.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/** Group-0 binding of each buffer the selection kernel reads, under its WGSL name. */
export const DAG_BINDING = {
  clusters: 0,
  nodes: 1,
  views: 2,
  flags: 3,
  out: 4,
  work: 5,
  worlds: 6,
  frames: 7,
  cold: 8,
  range: 9,
} as const

const B = DAG_BINDING

/** The tables a cut splits in parts past one binding (`../split.ts`), in the order their extra
 *  bindings follow `range`, and whether the kernel writes them. */
const DAG_PART_TABLES = { clusters: false, nodes: false, cold: false, flags: true } as const
export type DagPartTable = keyof typeof DAG_PART_TABLES
/** Parts 1 on of each split table: part 0 is the table's own binding. */
type DagExtraParts = Partial<Record<DagPartTable, readonly GPUBuffer[]>>

/** The bindings parts 1 on of each table take, from the binding behind `range`, table after table:
 *  `counts` the parts of each. None when every table is whole. */
export function dagPartBindings(counts: Partial<Record<DagPartTable, number>> = {}) {
  const out: { name: string; table: DagPartTable; part: number; binding: number }[] = []
  let binding = DAG_BINDING.range + 1
  for (const table of Object.keys(DAG_PART_TABLES) as DagPartTable[])
    for (let part = 1; part < (counts[table] ?? 1); part++)
      out.push({ name: `${table}${part}`, table, part, binding: binding++ })
  return out
}

/** The parts of each table `extra` lays out. */
const countsOf = (extra: DagExtraParts = {}) =>
  Object.fromEntries(Object.entries(extra).map(([table, list]) => [table, list.length + 1]))

/** Group 0 of the selection kernel, each buffer at its WGSL name's binding, and `range` the
 *  primitives its `frames` holds (`../frameRanges.ts`): the camera cut's, the light cut's and the
 *  dispatch bench's. `parts`, a split table's further parts, each at its own binding. */
export function dagGroupEntries(
  buffers: Record<Exclude<keyof typeof DAG_BINDING, 'range'>, GPUBuffer> & {
    parts?: DagExtraParts
  },
  range: GPUBufferBinding,
) {
  const { parts, ...whole } = buffers
  const named = Object.entries(whole).map(([name, buffer]) => [name, { buffer }])
  return [
    ...namedBufferEntries(DAG_BINDING, { ...Object.fromEntries(named), range }),
    ...dagPartBindings(countsOf(parts)).map(({ table, part, binding }) => ({
      binding,
      resource: { buffer: parts![table]![part - 1] },
    })),
  ]
}

/**
 * How the kernel reads the tables a device may split: one accessor each, the table itself when it
 * is whole. A split replaces them (`splitWgsl.ts`); no stage indexes the tables directly.
 */
export const DAG_ACCESS_WGSL = wgslBlock(
  'DAG_ACCESS_WGSL',
  [],
  `fn clusterAt(i:u32)->Cluster{return clusters[i];}
fn nodeAt(i:u32)->CullNode{return nodes[i];}
fn coldAt(i:u32)->u32{return cold[i];}
fn flagAt(i:u32)->u32{return flags[i];}
fn setFlag(i:u32,v:u32){flags[i]=v;}`,
)

/** Group-0 declarations of the selection kernel; its table accessors are the program's choice
 *  (`dagSelectionWgsl`). */
export const DAG_BINDINGS_WGSL = wgslBlock(
  'DAG_BINDINGS_WGSL',
  [],
  `@group(0) @binding(${B.clusters}) var<storage, read> clusters:array<Cluster>;
@group(0) @binding(${B.nodes}) var<storage, read> nodes:array<CullNode>;
@group(0) @binding(${B.views}) var<uniform> views:array<Uniforms,MAX_VIEWS>;
@group(0) @binding(${B.flags}) var<storage, read_write> flags:array<u32>;
@group(0) @binding(${B.out}) var<storage, read_write> out:Output;
@group(0) @binding(${B.work}) var<storage, read_write> work:array<atomic<u32>>;
@group(0) @binding(${B.worlds}) var<storage, read> worlds:array<vec4f>;
@group(0) @binding(${B.frames}) var<storage, read_write> frames:array<vec4f>;
@group(0) @binding(${B.cold}) var<storage, read> cold:array<u32>;
@group(0) @binding(${B.range}) var<uniform> range:FrameRange;
`,
)

const read = 'read-only-storage',
  write = 'storage'
const DAG_TYPES: Record<keyof typeof DAG_BINDING, GPUBufferBindingType> = {
  clusters: read,
  nodes: read,
  views: 'uniform',
  flags: write,
  out: write,
  work: write,
  worlds: read,
  frames: write,
  cold: read,
  range: 'uniform',
}

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * browser probes READ them here — none copies them, so none can lag behind the shader. `counts`,
 * the parts of each split table: each further part at its binding (`dagPartBindings`).
 */
export function dagBindEntries(
  counts?: Partial<Record<DagPartTable, number>>,
): GPUBindGroupLayoutEntry[] {
  const entry = (binding: number, type: GPUBufferBindingType) => ({
    binding,
    visibility: COMPUTE,
    buffer: { type },
  })
  return [
    ...Object.entries(DAG_BINDING).map(([name, binding]) =>
      entry(binding, DAG_TYPES[name as keyof typeof DAG_BINDING]),
    ),
    ...dagPartBindings(counts).map(({ table, binding }) =>
      entry(binding, DAG_PART_TABLES[table] ? write : read),
    ),
  ].sort((a, b) => a.binding - b.binding)
}
