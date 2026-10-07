import { DAG_BINDINGS_WGSL, dagPartBindings } from './bindings.ts'
import { DAG_SELECTION_SHADER, dagSelectionWgsl } from './shader.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { dagPartCounts, type DagSplit } from '../split.ts'
import { type TableSplit } from '../splitFlags.ts'
import { PAGE_SECTIONS } from '../flagSections.ts'

/** Part `part` of `table`: the table itself for the first, the part's own binding after. */
const partName = (table: string, part: number) => (part ? `${table}${part}` : table)

/** A read of element `i` of a table of `parts` parts of `per` elements each. */
function equalParts(fn: string, table: string, type: string, { per, parts }: TableSplit) {
  const at = (part: number) => (part ? `i-${part * per}u` : 'i')
  let body = ''
  for (let part = 0; part < parts - 1; part++)
    body += `if(i<${(part + 1) * per}u){return ${partName(table, part)}[${at(part)}];}`
  return `fn ${fn}(i:u32)->${type}{${body}return ${partName(table, parts - 1)}[${at(parts - 1)}];}`
}

/** The reads and writes of a `flags` cut at section starts: `flagSection`, the kernel's own section
 *  bases (`queueBase`, `../split.ts` `flagSectionStart`), so a camera cut and a light cut of other queue
 *  capacities share one text. */
function flagParts(cuts: readonly number[]) {
  const P = PAGE_SECTIONS
  const section = `fn flagSection(s:u32)->u32{if(s==0u){return 0u;}if(s<=${P}u){return views[0u].queueCap+(s-1u)*views[0u].clusterCount;}return queueBase(s-${P}u);}`
  const at = (part: number) => (part ? `i-flagSection(${cuts[part - 1]}u)` : 'i')
  let read = '',
    write = ''
  for (let part = 0; part < cuts.length; part++) {
    const within = `if(i<flagSection(${cuts[part]}u))`
    read += `${within}{return ${partName('flags', part)}[${at(part)}];}`
    write += `${within}{${partName('flags', part)}[${at(part)}]=v;return;}`
  }
  const last = partName('flags', cuts.length)
  return `${section}
fn flagAt(i:u32)->u32{${read}return ${last}[${at(cuts.length)}];}
fn setFlag(i:u32,v:u32){${write}${last}[${at(cuts.length)}]=v;}`
}

/** Declarations of every further part `split` binds, then the accessors that read across them. */
function dagSplitAccessWgsl(split: DagSplit) {
  const types = { clusters: 'Cluster', nodes: 'CullNode', cold: 'u32', flags: 'u32' }
  const declared = dagPartBindings(dagPartCounts(split)).map(
    ({ name, table, binding }) =>
      `@group(0) @binding(${binding}) var<storage, ${table === 'flags' ? 'read_write' : 'read'}> ${name}:array<${types[table]}>;`,
  )
  return [
    ...declared,
    equalParts('clusterAt', 'clusters', 'Cluster', split.clusters),
    equalParts('nodeAt', 'nodes', 'CullNode', split.nodes),
    equalParts('coldAt', 'cold', 'u32', split.cold),
    flagParts(split.flagCuts),
  ].join('\n')
}

/** What the accessors' text depends on, short: each table's elements a part and parts, then the
 *  sections the flags are cut at. */
const splitKey = ({ clusters, nodes, cold, flagCuts }: DagSplit) =>
  `${[clusters, nodes, cold].map(({ per, parts }) => `${per}x${parts}`).join(' ')} flags ${flagCuts.join(',')}`

/**
 * The selection kernel for `split`: the shipped text itself when every table is whole, otherwise
 * the same stages over the split tables' parts — only the accessors change (`DAG_ACCESS_WGSL`).
 */
export function dagSelectionShader(split?: DagSplit) {
  if (!split || !dagPartBindings(dagPartCounts(split)).length) return DAG_SELECTION_SHADER
  return dagSelectionWgsl(
    wgslBlock(`dagSplitAccess(${splitKey(split)})`, [DAG_BINDINGS_WGSL], dagSplitAccessWgsl(split)),
  )
}
