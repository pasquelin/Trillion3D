import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import {
  BOUNCE_SETTINGS,
  PROXY_CHILDREN,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/index.ts'
import { WIDE_NODE_WGSL } from './nodeWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import {
  rayBoxEntry,
  rayInverseDirection,
  rayTriangleDistance,
} from '../../../math/src/wgsl/geometry.ts'

/**
 * What differs between the traversals of a wide tree (`wideTraversal`): the way in, how a node and
 * its children are read, what a triangle test does and what a hit leaves, and the bound on the walk.
 * Everything else — the slab tests, the nearest child first, the stack, the retest of a popped node
 * against the nearest hit — is written once.
 */
export type WideTraversal = {
  name: string
  /** Parameters after `limit`, with their leading comma. */
  params: string
  returns: string
  /** The statement making `best`, the result so far. */
  start: string
  /** What a tree with no node answers, a statement. */
  empty: string
  /** The bound on the nodes a ray visits, an expression. */
  steps: string
  /** A node's bounds and a child record of a node's slot, as expressions of `node`, `slot`, `frame`. */
  box: string
  child: string
  /** Statements run once per visited node, and where a bound ends the ray, in each loop. */
  visit: string
  stop: string
  /** The triangle test of the leaf slot `child`, each triangle `index`. */
  test: string
  /** What a child the stack has no room for does to the ray, a statement: it is never dropped in
   *  silence, the ray is exhausted (`bounce/runtimeLayout.ts`). */
  overflow: string
  /** What the traversal returns. */
  answer: string
}

/** A hook's statement on its own line at `indent`, or nothing: a traversal without one keeps its text. */
const hook = (statement: string, indent: number) =>
  statement ? `\n${' '.repeat(indent)}${statement}` : ''

/**
 * The one traversal of a wide tree, from which every ray of the engine is cast: written from this
 * text with the way a tree is read and what a hit is (`WideTraversal`) given by its caller. The
 * proxy's walk of one mesh (`rtTraceCut`, `runtimeSceneWgsl.ts`) is its instance, nearest hit or, for a
 * shadow, the first one.
 */
export const wideTraversal = (t: WideTraversal) => `
fn ${t.name}(origin:vec3f,direction:vec3f,limit:f32${t.params})->${t.returns}{
 ${t.start}
 ${t.empty}
 let inverse=rayInverseDirection(direction);
 var stack:array<u32,${BOUNCE_SETTINGS.traversalStack}>;
 var depth=0u;
 var node=0u;
 let steps=${t.steps};
 for(var step=0u;step<steps;step++){${hook(t.stop, 2)}${hook(t.visit, 2)}
  let frame=${t.box};
  if(rayBoxEntry(frame.low,frame.high,origin,inverse,best.distance)>best.distance){
   if(depth==0u){break;}
   depth--;node=stack[depth];continue;
  }
  var nearest=0u;
  var nearestSpan=best.distance+1.0;
  for(var slot=0u;slot<CHILDREN;slot++){${hook(t.stop, 3)}
   let child=${t.child};
   if(!child.present){continue;}
   let span=rayBoxEntry(child.box.low,child.box.high,origin,inverse,best.distance);
   if(span>best.distance){continue;}
   if(child.count>0u){
    for(var k=0u;k<LEAF_TRIANGLES;k++){
     if(k>=child.count){break;}${hook(t.stop, 5)}
     let index=child.offset+k;
     ${t.test}
    }
    continue;
   }
   if(span<nearestSpan){
    if(nearestSpan<=best.distance){
     if(depth<STACK_DEPTH){stack[depth]=nearest;depth++;}else{${t.overflow}}
    }
    nearest=child.offset;
    nearestSpan=span;
   }else if(depth<STACK_DEPTH){stack[depth]=child.offset;depth++;}else{${t.overflow}}
  }
  if(nearestSpan<=best.distance){node=nearest;continue;}
  if(depth==0u){break;}
  depth--;node=stack[depth];
 }
 return ${t.answer};
}`

/**
 * The constants of a wide traversal and the blocks it reads: the leaf's triangles, the numbers of a triangle,
 * the children of a node, the stack. Three bounds known before the frame: visited nodes (the walk's own
 * steps), triangles of a leaf, and stack depth — a wide node stacks three at most, and the tree is balanced by
 * construction, so the stack does not overflow; if it did, the ray would be exhausted (`overflow`), the one rule
 * of a ray past its bounds: zero weight, never a darkening nor a leak.
 */
export const WIDE_TRAVERSAL_WGSL = wgslBlock(
  'WIDE_TRAVERSAL_WGSL',
  [WIDE_NODE_WGSL, rayInverseDirection, rayBoxEntry, rayTriangleDistance],
  wgslConsts({
    LEAF_TRIANGLES: BOUNCE_SETTINGS.proxyLeafTriangles,
    TRIANGLE_FLOATS: PROXY_TRIANGLE_FLOATS,
    CHILDREN: PROXY_CHILDREN,
    STACK_DEPTH: BOUNCE_SETTINGS.traversalStack,
  }),
)
