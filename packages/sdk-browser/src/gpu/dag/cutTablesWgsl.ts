/**
 * THE CUT'S TABLES AS A PASS BESIDE THE CUT READS THEM: the placement tree's refit
 * (`treeRefitWgsl.ts`), the composition of linked placements (`../../placement/gpuComposeWgsl.ts`)
 * and the ray query (`../../webgpu/rays/rayQueryWgsl.ts`) bind the cut's `nodes` and `cold` at the
 * cut's own bindings, a table the device splits in its further parts at theirs (`dagPartBindings`),
 * and its per-placement tables — `frames`, `worlds` — a buffer a range of placements
 * (`frameRanges.ts`). Each is read through one accessor written here, which crosses the parts or
 * the ranges as the cut's do (`shader/splitWgsl.ts`).
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { partName } from './shader/splitWgsl.ts'
import { DAG_BINDING, dagPartBindings, type DagPartTable } from './shader/bindings.ts'
import { DAG_NODE_FLOATS } from './types.ts'

/** How a device lays a table out: the elements a part holds, and its parts. */
export type TableLayout = { per: number; parts: number }

/** Element `i` of a table of equal parts — word `k` of a record of `words`, a word when 1 — read or
 *  written through the part that holds it. */
function acrossParts(table: string, { per, parts }: TableLayout, words: number) {
  const at = (part: number) => (part ? `(i-${part * per}u)` : 'i')
  const index = (part: number) => (words > 1 ? `${at(part)}*${words}u+k` : at(part))
  const target = (part: number) => `${partName(table, part)}[${index(part)}]`
  let read = '',
    write = ''
  for (let part = 0; part < parts - 1; part++) {
    const within = `if(i<${(part + 1) * per}u)`
    read += `${within}{return ${target(part)};}`
    write += `${within}{${target(part)}=v;return;}`
  }
  return {
    read: `${read}return ${target(parts - 1)};`,
    write: `${write}${target(parts - 1)}=v;`,
  }
}

/** The declarations of `table` and of its further parts in group `group`, at the cut's bindings. */
function partDeclarations(
  table: 'nodes' | 'cold',
  group: number,
  access: 'read' | 'read_write',
  counts: Partial<Record<DagPartTable, number>>,
) {
  const declare = (name: string, binding: number) =>
    `@group(${group}) @binding(${binding}) var<storage,${access}> ${name}:array<u32>;`
  return [
    declare(table, DAG_BINDING[table]),
    ...dagPartBindings(counts)
      .filter((part) => part.table === table)
      .map(({ name, binding }) => declare(name, binding)),
  ].join('\n')
}

/** The tree's nodes as a pass in group `group` reads them: `nodes` at the cut's binding and each
 *  further part at its own (`dagPartBindings`), `nodeWord` across them — and `setNodeWord` where the
 *  pass `writable`ly binds them. Whole, one binding. */
export function nodeTableBlock(
  layout: TableLayout,
  group: number,
  writable: boolean,
  /** The parts of every table the pass binds: the bindings number across them in turn. */
  counts: Partial<Record<DagPartTable, number>> = { nodes: layout.parts },
) {
  const across = acrossParts('nodes', layout, DAG_NODE_FLOATS)
  const key = `${layout.per}x${layout.parts} g${group}${writable ? 'w' : 'r'} ${JSON.stringify(counts)}`
  return wgslBlock(
    `nodeTable(${key})`,
    [],
    `${partDeclarations('nodes', group, writable ? 'read_write' : 'read', counts)}
fn nodeWord(i:u32,k:u32)->u32{${across.read}}
${writable ? `fn setNodeWord(i:u32,k:u32,v:u32){${across.write}}` : ''}`,
  )
}

/** The cold table — residency bits, the pool's list, the keys, the cold records, the tree's member
 *  order (`shader/recordWgsl.ts`) — as a pass in group `group` reads it: `coldAt` across its parts. */
export function coldTableBlock(
  layout: TableLayout,
  group: number,
  counts: Partial<Record<DagPartTable, number>> = { cold: layout.parts },
) {
  const key = `${layout.per}x${layout.parts} g${group} ${JSON.stringify(counts)}`
  return wgslBlock(
    `coldTable(${key})`,
    [],
    `${partDeclarations('cold', group, 'read', counts)}
fn coldAt(i:u32)->u32{${acrossParts('cold', layout, 1).read}}`,
  )
}

/**
 * `fn name(w:u32,k:u32)->u32`, word `k` of placement `w`'s data in a table held a buffer a range
 * (`frameRanges.ts`), the ranges starting at `firsts`: `table<r>` of the range `r` holding `w`, at
 * the index `at(r)` writes of the range's row `i` — `w` less the range's first — and `k`.
 */
export function rangeReader(
  name: string,
  table: string,
  firsts: readonly number[],
  at: (r: number) => string,
) {
  let body = ''
  firsts.forEach((first, r) => {
    const next = firsts[r + 1]
    const read = `let i=w-${first}u;return ${table}${r}[${at(r)}];`
    body += next === undefined ? `{${read}}` : `if(w<${next}u){${read}}`
  })
  return `fn ${name}(w:u32,k:u32)->u32{${body}}`
}
