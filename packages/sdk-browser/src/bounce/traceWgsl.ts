import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import {
  BOUNCE_SETTINGS,
  PROXY_CHILDREN,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/index.ts'
import { PROXY_OWNER_WGSL } from './ownerWgsl.ts'
import { BOUNCE_NODE_WGSL } from './nodeWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import {
  rayBoxEntry,
  rayInverseDirection,
  rayTriangleDistance,
} from '../../../math/src/wgsl/geometry.ts'

/**
 * The one traversal, written twice from this text: `traceProxy` answers the nearest triangle hit
 * (`ProxyHit`, the direction assumed normalized), `proxyBlocked` — a shadow does not need the
 * nearest — whether any triangle cuts the segment, returning at the first one: with no hit
 * recorded, the distance every box and triangle is tested against stays `limit`.
 */
const proxyTraversal = (name: string, anyHit: boolean) => `
fn ${name}(origin:vec3f,direction:vec3f,limit:f32)->${anyHit ? 'bool' : 'ProxyHit'}{
 var best=ProxyHit(limit,0u,0u,false);
 if(proxyNodeCount()==0u){return ${anyHit ? 'false' : 'best'};}
 let inverse=rayInverseDirection(direction);
 var stack:array<u32,${BOUNCE_SETTINGS.traversalStack}>;
 var depth=0u;
 var node=0u;
 let steps=proxySteps();
 for(var step=0u;step<steps;step++){
  let frame=nodeBox(node);
  if(rayBoxEntry(frame.low,frame.high,origin,inverse,best.distance)>best.distance){
   if(depth==0u){break;}
   depth--;node=stack[depth];continue;
  }
  var nearest=0u;
  var nearestSpan=best.distance+1.0;
  for(var slot=0u;slot<CHILDREN;slot++){
   let child=proxyChild(node,slot,frame);
   if(!child.present){continue;}
   let span=rayBoxEntry(child.box.low,child.box.high,origin,inverse,best.distance);
   if(span>best.distance){continue;}
   if(child.count>0u){
    for(var k=0u;k<LEAF_TRIANGLES;k++){
     if(k>=child.count){break;}
     let index=child.offset+k;
     let owners=proxyOwners(index,child.owned);
     for(var owner=owners.x;owner<owners.y;owner++){
      let distance=rayTriangleDistance(origin,direction,proxyOwnerVertex(index,0u,owner),proxyOwnerVertex(index,1u,owner),proxyOwnerVertex(index,2u,owner),best.distance);
      if(distance<best.distance){${anyHit ? 'return true;' : 'best=ProxyHit(distance,index,owner,true);'}}
     }
    }
    continue;
   }
   if(span<nearestSpan){
    if(nearestSpan<=best.distance&&depth<STACK_DEPTH){stack[depth]=nearest;depth++;}
    nearest=child.offset;
    nearestSpan=span;
   }else if(depth<STACK_DEPTH){stack[depth]=child.offset;depth++;}
  }
  if(nearestSpan<=best.distance){node=nearest;continue;}
  if(depth==0u){break;}
  depth--;node=stack[depth];
 }
 return ${anyHit ? 'false' : 'best'};
}`

/**
 * Traversal of the resident proxy: a four-child BVH, ordered by distance, with early
 * exit.
 *
 * A node tests its four boxes at once, descends immediately on the nearest and stacks the
 * others. A popped node is retested against the distance of the nearest triangle already
 * hit: as soon as a ray has hit something, everything behind it drops without being
 * opened. That is what replaces the one-step-per-node descent of the binary tree, where
 * the traversal bound ran out before the leaf on a city's proxy.
 *
 * Three bounds known before the frame: visited nodes (the built tree's bound plus the
 * nodes a refit let into a ray, written with the tree: `proxy.steps`), triangles of a leaf,
 * and stack depth — a wide node stacks three at most, and the tree is balanced by
 * construction, so the stack does not overflow; if it did, the extra child would be dropped, which darkens and never leaks.
 */
export const BOUNCE_TRACE_WGSL = wgslBlock(
  'BOUNCE_TRACE_WGSL',
  [BOUNCE_NODE_WGSL, PROXY_OWNER_WGSL, rayInverseDirection, rayBoxEntry, rayTriangleDistance],
  `
${wgslConsts({
  LEAF_TRIANGLES: BOUNCE_SETTINGS.proxyLeafTriangles,
  TRIANGLE_FLOATS: PROXY_TRIANGLE_FLOATS,
  CHILDREN: PROXY_CHILDREN,
  STACK_DEPTH: BOUNCE_SETTINGS.traversalStack,
})}
struct ProxyHit{distance:f32,triangle:u32,owner:u32,found:bool,}
${proxyTraversal('traceProxy', false)}
${proxyTraversal('proxyBlocked', true)}`,
)
