import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { rayBoxEntry } from '../../../../math/src/wgsl/geometry.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { NODE_CHILD_COUNT, NODE_FIRST_CHILD, NODE_KIND } from './nodeLayout.ts'
import { TREE_GROUP } from './placementTree.ts'

/** Tree levels a ray walks down at most: a tree of 64-way nodes holds 2⁴² members in seven. */
const TREE_DEPTH = 8

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
  /** A statement before each step, which may end the walk (`done=true;break;`); and one per child read. */
  stop: string
  visit: string
  /** The bound on the walk's steps, an expression. */
  steps: string
  /** What a walk cut short by its steps, not by the tree's end, does: a statement. */
  cut: string
}

/** The constants the walk reads: its depth, the words of a tree node it reads, its group kind, and
 *  the slot no placement holds (`NO_INDEX`). */
export const PLACEMENT_TREE_WALK_WGSL = wgslBlock(
  'PLACEMENT_TREE_WALK_WGSL',
  [rayBoxEntry, NO_INDEX],
  wgslConsts({
    WALK_DEPTH: TREE_DEPTH,
    WALK_NODE_COUNT: NODE_CHILD_COUNT,
    WALK_NODE_FIRST: NODE_FIRST_CHILD,
    WALK_NODE_KIND: NODE_KIND,
    WALK_GROUP: TREE_GROUP,
  }),
)

/**
 * THE ONE WALK OF THE PLACEMENT TREE BY A RAY (`placementTree.ts`): depth first from its top, a
 * cell's child entered when the ray meets its world box before the nearest hit so far (`best`), a
 * group's members entered one by one — each member tests its own box (`enter`). A level a cursor,
 * no stack of boxes: the tree is at most `WALK_DEPTH` levels deep. The run-time proxy's rays
 * (`../../bounce/runtimeSceneWgsl.ts`) and the ray query (`../../webgpu/rays/rayQueryWgsl.ts`) walk it
 * so, each reading the tree in its record table (`treeTable.ts`). The text is a function's body: it reads `origin`,
 * `inverse` and `best`, and declares `at`, `next`, `level` and `done`.
 */
export const placementTreeWalk = (t: TreeWalk) => `
  var at:array<u32,WALK_DEPTH>;
  var next:array<u32,WALK_DEPTH>;
  var level=0u;
  var done=false;
  at[0]=${t.root};
  next[0]=0u;
  for(var step=0u;step<${t.steps};step++){
   ${t.stop}
   let node=at[level];
   let count=${t.table}Word(node,WALK_NODE_COUNT);
   let k=next[level];
   if(k>=count){
    if(level==0u){done=true;break;}
    level--;
    continue;
   }
   next[level]=k+1u;
   ${t.visit}
   let first=${t.table}Word(node,WALK_NODE_FIRST);
   if(${t.table}Word(node,WALK_NODE_KIND)==WALK_GROUP){
    let w=${t.table}Member(first+k);
    if(w!=NO_INDEX){
     ${t.enter}
    }
   }else{
    let child=first+k;
    if(rayBoxEntry(${t.table}Low(child),${t.table}High(child),origin,inverse,best.distance)<=best.distance&&level+1u<WALK_DEPTH){
     level++;
     at[level]=child;
     next[level]=0u;
    }
   }
  }
  // A walk that ran out of steps, not of tree, answers nothing it can vouch for.
  if(!done){${t.cut}}`
