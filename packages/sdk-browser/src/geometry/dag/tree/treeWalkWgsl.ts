import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { toF32 } from '../../../../../math/src/wgsl/f32.ts'
import { rayBoxEntry, rayInverseDirection } from '../../../../../math/src/wgsl/geometry.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { NODE_CHILD_COUNT, NODE_FIRST_CHILD, NODE_KIND } from '../nodeLayout.ts'
import { TREE_GROUP } from '../placement/placementTree.ts'

/** Tree levels a ray walks down at most: a tree of 64-way nodes holds 2⁴² members in seven. */
const TREE_DEPTH = 8
/** Children a level holds ready, nearest first, from one scan of its node (`placementTreeWalk`). */
const WALK_LIST = 4
/** Steps a walk of the placement tree may take: a child a step, the members of every group a ray
 *  meets — a dense field along the ray included. */
export const TREE_STEPS = 1 << 16

/**
 * What differs between the rays that walk the placement tree (`placementTreeWalk`): where its nodes
 * are read, what entering a member does, and the ray's own bounds.
 */
type TreeWalk = {
  /** The tree's top node, an expression. */
  root: string
  /** The name the tree's record table is bound under: the walk reads its nodes' words, their box
   *  corners and its members by the table's own readers (`treeTableWgsl`, `treeTable.ts`). */
  table: string
  /** Statements entering placement `w`, which the walk leaves when they `return`. */
  enter: string
  /** Where the ray enters placement `w`'s world box, an expression of `w` past `best.distance` where it
   *  meets none: a group's members are then entered nearest first, as a cell's children are. A host
   *  that reads no member's box leaves it out: a group's members are entered in turn. */
  entry?: string
  /** A statement before each step, which may end the walk (`done=true;break;`); and one per child read. */
  stop: string
  visit: string
  /** The bound on the walk's steps, an expression. */
  steps: string
  /** What a walk cut short by its steps, not by the tree's end, does: a statement. */
  cut: string
  /** How far a cell's box is grown on every side, an expression: what the ray meets lies that near
   *  it — a line within its reach. Unset, the boxes as the tree holds them. */
  grow?: string
}

/** The constants the walk reads: its depth, the words of a tree node it reads, its group kind, and
 *  the slot no placement holds (`NO_INDEX`), with the functions of its cast (`placementTreeCast`). */
export const PLACEMENT_TREE_WALK_WGSL = wgslBlock(
  'PLACEMENT_TREE_WALK_WGSL',
  [rayBoxEntry, rayInverseDirection, toF32, NO_INDEX],
  wgslConsts({
    WALK_DEPTH: TREE_DEPTH,
    WALK_LIST,
    WALK_HELD: TREE_DEPTH * WALK_LIST,
    WALK_NODE_COUNT: NODE_CHILD_COUNT,
    WALK_NODE_FIRST: NODE_FIRST_CHILD,
    WALK_NODE_KIND: NODE_KIND,
    WALK_GROUP: TREE_GROUP,
  }),
)

/** The entry `e` of the child the walk's scan reads at `k`: a cell's node by its box, a group's member
 *  by the host's (`entry`), past the nearest hit where the slot holds no placement. */
const childEntry = (t: TreeWalk) => {
  const [low, high] = [`${t.table}Low(first+k)`, `${t.table}High(first+k)`].map((corner, side) =>
    t.grow ? `${corner}${side ? '+' : '-'}vec3f(${t.grow})` : corner,
  )
  const cell = `rayBoxEntry(${low},${high},origin,inverse,best.distance)`
  if (!t.entry) return `let e=${cell};`
  return `var e=best.distance+1.0;
    if(!group){e=${cell};}
    else{
     let w=${t.table}Member(first+k);
     if(w!=NO_INDEX){e=${t.entry};}
    }`
}

/** The walk's levels declared, its first level, and the head of each step. */
const walkHeadWgsl = (t: TreeWalk) => `
  var at:array<u32,WALK_DEPTH>;
  var held:array<u32,WALK_HELD>;
  var heldEntry:array<f32,WALK_HELD>;
  var size:array<u32,WALK_DEPTH>;
  var taken:array<u32,WALK_DEPTH>;
  var last:array<u32,WALK_DEPTH>;
  var lastEntry:array<f32,WALK_DEPTH>;
  var more:array<bool,WALK_DEPTH>;
  var level=0u;
  var step=0u;
  var done=false;
  at[0]=${t.root};
  size[0]=0u;
  taken[0]=0u;
  last[0]=NO_INDEX;
  more[0]=true;
  while(step<${t.steps}){
   ${t.stop}
   let node=at[level];
   let count=${t.table}Word(node,WALK_NODE_COUNT);
   let first=${t.table}Word(node,WALK_NODE_FIRST);
   let group=${t.table}Word(node,WALK_NODE_KIND)==WALK_GROUP;
   `

/** A group's next member, entered in turn, for a host that reads no member's box. */
const walkGroupWgsl = (t: TreeWalk) => `${
  t.entry
    ? ''
    : `if(group){
    // The group's next member, from its first: \`last\` its cursor.
    let k=last[level]+1u;
    if(k>=count){
     if(level==0u){done=true;break;}
     level--;
     continue;
    }
    last[level]=k;
    step++;
    ${t.visit}
    let w=${t.table}Member(first+k);
    if(w!=NO_INDEX){
     ${t.enter}
    }
    continue;
   }`
}
`

/** The scan of a node: its nearest children met before the best hit, held in order. */
const walkScanWgsl = (t: TreeWalk) => `   if(taken[level]>=size[level]){
    if(!more[level]){
     if(level==0u){done=true;break;}
     level--;
     continue;
    }
    // The nearest children after the last kept, met before the best hit, held in order.
    var n=0u;
    var over=false;
    for(var k=0u;k<count;k++){
     if(step>=${t.steps}){break;}
     ${t.stop}
     step++;
     ${t.visit}
     ${childEntry(t)}
     let after=last[level]==NO_INDEX||e>lastEntry[level]||(e==lastEntry[level]&&k>last[level]);
     if(!(e<=best.distance)||!after){continue;}
     if(n==WALK_LIST&&!(e<heldEntry[level*WALK_LIST+n-1u])){over=true;continue;}
     if(n==WALK_LIST){over=true;n--;}
     var j=n;
     while(j>0u&&e<heldEntry[level*WALK_LIST+j-1u]){
      held[level*WALK_LIST+j]=held[level*WALK_LIST+j-1u];
      heldEntry[level*WALK_LIST+j]=heldEntry[level*WALK_LIST+j-1u];
      j--;
     }
     held[level*WALK_LIST+j]=k;
     heldEntry[level*WALK_LIST+j]=e;
     n++;
    }
    if(done||step>=${t.steps}){break;}
    size[level]=n;
    taken[level]=0u;
    more[level]=over;
    if(n>0u){last[level]=held[level*WALK_LIST+n-1u];lastEntry[level]=heldEntry[level*WALK_LIST+n-1u];}
    continue;
   }
`

/** The next child held, entered, and the answer of a walk that ran out of steps. */
const walkEnterWgsl = (t: TreeWalk) => `   let slot=level*WALK_LIST+taken[level];
   taken[level]++;
   // Past the best hit: so is every child after it, kept or not.
   if(!(heldEntry[slot]<=best.distance)){taken[level]=size[level];more[level]=false;continue;}
   let k=held[slot];
   if(group){
    let w=${t.table}Member(first+k);
    ${t.enter}
   }else if(level+1u<WALK_DEPTH){
    level++;
    at[level]=first+k;
    size[level]=0u;
    taken[level]=0u;
    last[level]=NO_INDEX;
    more[level]=true;
   }
  }
  // A walk that ran out of steps, not of tree, answers nothing it can vouch for.
  if(!done){${t.cut}}`

/**
 * THE ONE WALK OF THE PLACEMENT TREE BY A RAY (`../placement/placementTree.ts`): FRONT TO BACK, from its top. One scan of a
 * node reads its children's boxes — a cell's nodes, a group's members by theirs (`entry`) — and keeps the
 * `WALK_LIST` nearest the ray meets before the best hit (`best`), by entry then index; the walk enters them
 * in that order, and a kept child past the best hit ends the node: every later one is farther. A node with
 * more children met than its list holds is scanned again from after the last one kept. So a ray's budget
 * goes to the surfaces nearest it: in index order, a long ray across a dense field spent it on the far
 * patches it met first. A host that reads no member's box (the ray query, bounded by its steps alone)
 * enters a group's members in turn, each testing its own.
 *
 * A level holds its node, its list (`WALK_LIST` indices and entries), how many it holds and has entered,
 * the last kept and whether the scan left any out: `2 · WALK_LIST + 6` words, `WALK_DEPTH` levels. Cost: a
 * scan is `count` box tests (at most `TREE_SPAN`), a step and a `visit` each — as one child each cost in
 * index order —, entering a child none; a node is scanned again only where more than `WALK_LIST` of its
 * children lie nearer than every hit they hold. The walk is bounded by `steps`, a unit a box.
 *
 * The ray query (`../../../lighting/rays/rayQueryWgsl.ts`) and the scene trace
 * (`../../../lighting/rays/sceneTrace/sceneTraceWgsl.ts`) walk it so, reading the tree in its record
 * table (`treeTable.ts`). The text is a function's body: it reads `origin`, `inverse` and `best`, and
 * declares `at`, `held`, `heldEntry`, `size`, `taken`, `last`, `lastEntry`, `more`, `slot`, `level`,
 * `step` and `done`.
 */
const placementTreeWalk = (t: TreeWalk) =>
  walkHeadWgsl(t) + walkGroupWgsl(t) + walkScanWgsl(t) + walkEnterWgsl(t)

/** What a ray cast through the placement tree is given beside the walk's own hooks
 *  (`placementTreeCast`): the eye's exact position as the words the ray holds it in (`vec4u` of the
 *  x and y doubles, `vec2u` of the z), the ray's origin from the eye (the eye itself when unset), its
 *  direction, and the placements a packing holds. */
type TreeCast = TreeWalk & {
  eyeXY: string
  eyeZ: string
  offset?: string
  direction: string
  placements: string
}

/**
 * THE ONE CAST OF A RAY THROUGH THE PLACEMENT TREE, in a function's body: the ray's origin rounded
 * to single precision from the eye — the tree's boxes are world boxes in single precision, grown past
 * its rounding, so the ray meets them from its origin rounded so, its distances those of the exact
 * origin —, then the walk (`placementTreeWalk`) of the tree from its top; a packing too small for a
 * tree (`root` none) enters its placements in turn. Reads `best`; declares `origin` and `inverse`
 * with the walk's.
 */
export const placementTreeCast = (t: TreeCast) => {
  const eye = `vec3f(bitcast<f32>(toF32(${t.eyeXY}.xy)),bitcast<f32>(toF32(${t.eyeXY}.zw)),bitcast<f32>(toF32(${t.eyeZ})))`
  return ` let origin=${t.offset ? `${eye}+${t.offset}` : eye};
 let inverse=rayInverseDirection(${t.direction});
 if(${t.root}==NO_INDEX){
  for(var w=0u;w<${t.placements};w++){${t.enter}}
 }else{
${placementTreeWalk(t)}
 }`
}
