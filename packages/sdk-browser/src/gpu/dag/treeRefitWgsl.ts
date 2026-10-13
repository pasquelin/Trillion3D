/**
 * THE PLACEMENT TREE REFIT, in the shader (`treeRefit.ts`): the boxes of the nodes a change touched,
 * bottom up, each the CPU build's to the word (`fitPlacementTree`, `placementTree.ts`). A group's box
 * is the union of its members' leaf boxes — doubles, `members` six a placement, `memberBox` or a
 * composition's own —, a cell's the union of its children's boxes as the nodes hold them; both grown
 * by `MARGIN` of the farthest coordinate and the widest side, then stored as single precision. Every
 * box is finite: a member's leaf holds its deformation's reach (`memberBox`), and one drawn whatever
 * the view is opened from queue 0, never by its group (`placementTree.ts`). A parked member, or a
 * slot no placement holds, holds nothing; a node that holds nothing takes the empty box, its bounds
 * crossed at the finite sentinel (`FINITE_SENTINEL`), which every union passes over.
 *
 * Group 0 binds the cut's own tables as the cut binds them (`shader/bindings.ts`): `nodes` and `cold`,
 * each at its binding, a table the device splits in its further parts at theirs (`dagPartBindings`),
 * read through accessors — `nodeWord`, `setNodeWord`, `coldAt` — that cross the parts as the cut's do
 * (`shader/splitWgsl.ts`). Group 1 binds the pass's own:
 *
 *   params      uniform        the level's first id, how many, and what it fits (below)
 *   ids         array<u32>     the nodes of the level to fit, as their index within it
 *   members     array<vec2u>   each placement's leaf box, six doubles
 *   frames<r>   array<u32>     each placement's frame words: its root, its mark, a buffer a range
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { dAbs, dAdd, dLess, dMax, dMin, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { fromF32, toF32 } from '../../../../math/src/wgsl/f32.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../dispatch/grid.ts'
import { partName } from './shader/splitWgsl.ts'
import { DAG_BINDING, dagPartBindings, type DagPartTable } from './shader/bindings.ts'
import { SELECTION_NONE } from '../core/selection.ts'
import { FRAME_ROW_WORDS, DAG_NODE_FLOATS } from './types.ts'
import { MARGIN, TREE_SPAN } from './placementTree.ts'
import { NODE_MAX, NODE_MIN } from './nodeLayout.ts'
import { FINITE_SENTINEL } from '../../../../math/src/wgsl/constants.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'

/** Where a placement's root lies in its frame row (`primitiveFrameWords`). */
const FRAME_ROOT = 1
/** What the shader reads a level's parameters as: words of `Params`. */
export const REFIT_PARAM_WORDS = 8

/** The margin as the shaders hold a double, high word then low (`packDoubles`). */
const margin = new Uint32Array(2)
packDoubles(margin, 0, [MARGIN])

/** The node `n` written from the doubles `lo` and `hi`: the empty box when they cross, else as
 *  fitted. */
const WRITE_BOX_WGSL = wgslBlock(
  'WRITE_BOX_WGSL',
  [dAdd, dSub, dMul, dLess, dMax, dAbs, toF32, FINITE_SENTINEL],
  `
fn writeBox(n:u32,lo:array<vec2u,3>,hi:array<vec2u,3>){
 if(dLess(hi[0],lo[0])||dLess(hi[1],lo[1])||dLess(hi[2],lo[2])){
  let low=bitcast<u32>(FINITE_SENTINEL);
  let high=bitcast<u32>(-FINITE_SENTINEL);
  for(var a=0u;a<3u;a++){setNodeWord(n,${NODE_MIN}u+a,low);setNodeWord(n,${NODE_MAX}u+a,high);}
  return;
 }
 var reach=vec2u(0u,0u);
 for(var a=0u;a<3u;a++){
  reach=dMax(reach,dMax(dAbs(lo[a]),dAbs(hi[a])));
  reach=dMax(reach,dSub(hi[a],lo[a]));
 }
 let grown=dMul(reach,vec2u(${margin[0]}u,${margin[1]}u));
 for(var a=0u;a<3u;a++){
  setNodeWord(n,${NODE_MIN}u+a,toF32(dSub(lo[a],grown)));
  setNodeWord(n,${NODE_MAX}u+a,toF32(dAdd(hi[a],grown)));
 }
}`,
)

const FIT_WGSL = wgslBlock(
  'FIT_WGSL',
  [WRITE_BOX_WGSL, fromF32, dMin, dMax],
  `
fn fitGroup(j:u32){
 let first=j*${TREE_SPAN}u;
 var gm=0u;
 if(params.live>first){gm=min(params.live-first,${TREE_SPAN}u);}
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){lo[a]=vec2u(0x7ff00000u,0u);hi[a]=vec2u(0xfff00000u,0u);}
 for(var k=0u;k<gm;k++){
  let w=coldAt(params.members+first+k);
  if(w==${SELECTION_NONE}u){continue;}
  if(frameWord(w,${FRAME_ROOT}u)==${SELECTION_NONE}u){continue;}
  for(var a=0u;a<3u;a++){
   lo[a]=dMin(lo[a],members[w*6u+a]);
   hi[a]=dMax(hi[a],members[w*6u+3u+a]);
  }
 }
 writeBox(params.base+j,lo,hi);
}
fn fitCell(j:u32){
 let first=j*${TREE_SPAN}u;
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){lo[a]=vec2u(0x7ff00000u,0u);hi[a]=vec2u(0xfff00000u,0u);}
 let end=min(first+${TREE_SPAN}u,params.childCount);
 for(var c=first;c<end;c++){
  let child=params.childBase+c;
  for(var a=0u;a<3u;a++){
   lo[a]=dMin(lo[a],fromF32(nodeWord(child,${NODE_MIN}u+a)));
   hi[a]=dMax(hi[a],fromF32(nodeWord(child,${NODE_MAX}u+a)));
  }
 }
 writeBox(params.base+j,lo,hi);
}`,
)

/** How the tables the refit reads are laid on a device: the elements of each part of `nodes` (a
 *  node) and `cold` (a word), the parts a table has, and the first placement of each range of
 *  `frames`. */
export type RefitLayout = {
  nodes: { per: number; parts: number }
  cold: { per: number; parts: number }
  frames: readonly number[]
}

/** Every table whole: one part each, one range. */
export const WHOLE_LAYOUT: RefitLayout = {
  nodes: { per: Infinity, parts: 1 },
  cold: { per: Infinity, parts: 1 },
  frames: [0],
}

/** Element `i` of a table of equal parts — word `k` of a record of `words`, a word when 1 — read or
 *  written through the part that holds it. */
function acrossParts(table: string, { per, parts }: { per: number; parts: number }, words: number) {
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

/** The tree's nodes as a pass in group `group` reads them: `nodes` at the cut's binding and each
 *  further part at its own (`dagPartBindings`), `nodeWord` across them — and `setNodeWord` where the
 *  pass `writable`ly binds them. Whole, one binding. */
export function nodeTableBlock(
  layout: RefitLayout['nodes'],
  group: number,
  writable: boolean,
  /** The parts of every table the pass binds: the bindings number across them in turn. */
  counts: Partial<Record<DagPartTable, number>> = { nodes: layout.parts },
) {
  const access = writable ? 'read_write' : 'read',
    declare = (name: string, binding: number) =>
      `@group(${group}) @binding(${binding}) var<storage,${access}> ${name}:array<u32>;`
  const across = acrossParts('nodes', layout, DAG_NODE_FLOATS)
  const key = `${layout.per}x${layout.parts} g${group}${writable ? 'w' : 'r'} ${JSON.stringify(counts)}`
  return wgslBlock(
    `nodeTable(${key})`,
    [],
    `${declare('nodes', DAG_BINDING.nodes)}
${dagPartBindings(counts)
  .filter(({ table }) => table === 'nodes')
  .map(({ name, binding }) => declare(name, binding))
  .join('\n')}
fn nodeWord(i:u32,k:u32)->u32{${across.read}}
${writable ? `fn setNodeWord(i:u32,k:u32,v:u32){${across.write}}` : ''}`,
  )
}

/** The declarations and accessors of the tables a refit of `layout` reads. */
function refitAccessBlock(layout: RefitLayout) {
  const counts = { nodes: layout.nodes.parts, cold: layout.cold.parts },
    extra = dagPartBindings(counts).filter(({ table }) => table === 'cold'),
    cold = acrossParts('cold', layout.cold, 1)
  const ranges = layout.frames
  let frames = ''
  ranges.forEach((first, r) => {
    const next = ranges[r + 1]
    const read = `return frames${r}[(w-${first}u)*${FRAME_ROW_WORDS}u+k];`
    frames += next === undefined ? read : `if(w<${next}u){${read}}`
  })
  return wgslBlock(
    `refitAccess(${JSON.stringify(layout)})`,
    [nodeTableBlock(layout.nodes, 0, true, counts)],
    `@group(0) @binding(${DAG_BINDING.cold}) var<storage,read> cold:array<u32>;
${extra.map(({ name, binding }) => `@group(0) @binding(${binding}) var<storage,read> ${name}:array<u32>;`).join('\n')}
${ranges.map((_, r) => `@group(1) @binding(${3 + r}) var<storage,read> frames${r}:array<u32>;`).join('\n')}
fn coldAt(i:u32)->u32{${cold.read}}
fn frameWord(w:u32,k:u32)->u32{${frames}}`,
  )
}

/**
 * One thread per node of a level: the group or the cell `ids` names, fitted. Its dispatches run
 * bottom up in one pass: the level above reads the boxes the one below wrote. `layout`: how the
 * device lays the tables out; whole by default.
 */
export function treeRefitWgsl(layout: RefitLayout = WHOLE_LAYOUT) {
  return wgslProgram(
    `struct Params{first:u32,count:u32,base:u32,live:u32,members:u32,childBase:u32,childCount:u32,cells:u32,}
@group(1) @binding(0) var<uniform> params:Params;
@group(1) @binding(1) var<storage,read> ids:array<u32>;
@group(1) @binding(2) var<storage,read> members:array<vec2u>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,64u);if(i>=params.count){return;}
 let j=ids[params.first+i];
 if(params.cells==0u){fitGroup(j);}else{fitCell(j);}
}`,
    [FLAT_INDEX_WGSL, FIT_WGSL, refitAccessBlock(layout)],
  )
}
