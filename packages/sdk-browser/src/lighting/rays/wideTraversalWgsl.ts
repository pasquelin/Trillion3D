import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  rayBoxEntry,
  rayInverseDirection,
  rayTriangleDistance,
} from '../../../../math/src/wgsl/geometry.ts'

/** The structs a wide tree's reader and traversal share: a box, and a child of a node (its box, the link it leads by, the items it holds, whether
 *  it exists). */
const WIDE_NODE_WGSL = wgslBlock(
  'WIDE_NODE_WGSL',
  [],
  `struct Box{low:vec3f,high:vec3f,}
struct WideChild{box:Box,offset:u32,count:u32,present:bool,}`,
)

/** The slab tests and the triangle test a traversal calls. */
export const WIDE_TRAVERSAL_WGSL = wgslBlock(
  'WIDE_TRAVERSAL_WGSL',
  [WIDE_NODE_WGSL, rayInverseDirection, rayBoxEntry, rayTriangleDistance],
  '',
)

/**
 * What a traversal of a wide tree (`wideTraversal`) is given: the way in, how a node and its children are read, what a triangle test
 * does and what a hit leaves, and the bounds on the walk. Everything else — the slab tests, the nearest child first, the stack, the
 * retest of a popped node against the nearest hit — is written once.
 */
type WideTraversal = {
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
   *  silence, the ray is marked cut short. */
  overflow: string
  /** What the traversal returns. */
  answer: string
  /** The first node, an expression. */
  root: string
  /** The slots a node is read for and the items a leaf child is tested for, expressions of `node` and `child`. */
  children: string
  leaf: string
  /** The nodes the stack holds. */
  stack: number
}

/** The stack's bound a push is checked against. */
const stackBound = (t: WideTraversal) => `${t.stack}u`

/** A hook's statement on its own line at `indent`, or nothing: a traversal without one keeps its text. */
const hook = (statement: string, indent: number) =>
  statement ? `\n${' '.repeat(indent)}${statement}` : ''

/**
 * The one traversal of a wide tree, from which every ray of the engine is cast: written from this
 * text with the way a tree is read and what a hit is (`WideTraversal`) given by its caller. The ray query's walk of one
 * placement's hierarchy is its instance (`../rays/rayPlacementWgsl.ts`).
 */
export const wideTraversal = (t: WideTraversal) => `
fn ${t.name}(origin:vec3f,direction:vec3f,limit:f32${t.params})->${t.returns}{
 ${t.start}
 ${t.empty}
 let inverse=rayInverseDirection(direction);
 var stack:array<u32,${stackBound(t)}>;
 var depth=0u;
 var node=${t.root};
 let steps=${t.steps};
 for(var step=0u;step<steps;step++){${hook(t.stop, 2)}${hook(t.visit, 2)}
  let frame=${t.box};
  if(rayBoxEntry(frame.low,frame.high,origin,inverse,best.distance)>best.distance){
   if(depth==0u){break;}
   depth--;node=stack[depth];continue;
  }
  var nearest=0u;
  var nearestSpan=best.distance+1.0;
  for(var slot=0u;slot<${t.children};slot++){${hook(t.stop, 3)}
   let child=${t.child};
   if(!child.present){continue;}
   let span=rayBoxEntry(child.box.low,child.box.high,origin,inverse,best.distance);
   if(span>best.distance){continue;}
   if(child.count>0u){
    for(var k=0u;k<${t.leaf};k++){
     if(k>=child.count){break;}${hook(t.stop, 5)}
     let index=child.offset+k;
     ${t.test}
    }
    continue;
   }
   if(span<nearestSpan){
    if(nearestSpan<=best.distance){
     if(depth<${stackBound(t)}){stack[depth]=nearest;depth++;}else{${t.overflow}}
    }
    nearest=child.offset;
    nearestSpan=span;
   }else if(depth<${stackBound(t)}){stack[depth]=child.offset;depth++;}else{${t.overflow}}
  }
  if(nearestSpan<=best.distance){node=nearest;continue;}
  if(depth==0u){break;}
  depth--;node=stack[depth];
 }
 return ${t.answer};
}`
