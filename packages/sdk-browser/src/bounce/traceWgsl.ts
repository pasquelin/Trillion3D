import {
  BOUNCE_SETTINGS,
  PROXY_CHILDREN,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/index.ts';
import { BOUNCE_NODE_WGSL } from './nodeWgsl.ts';

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
 * Three bounds known before the frame (X2): visited nodes, triangles of a leaf, and stack
 * depth — a wide node stacks three at most, and the tree is balanced by construction, so
 * the stack does not overflow; if it did, the extra child would be dropped, which darkens
 * and never leaks.
 */
export const BOUNCE_TRACE_WGSL = `
const TRAVERSAL_STEPS:u32=${BOUNCE_SETTINGS.traversalSteps}u;
const LEAF_TRIANGLES:u32=${BOUNCE_SETTINGS.proxyLeafTriangles}u;
const TRIANGLE_FLOATS:u32=${PROXY_TRIANGLE_FLOATS}u;
const CHILDREN:u32=${PROXY_CHILDREN}u;
const STACK_DEPTH:u32=${BOUNCE_SETTINGS.traversalStack}u;
struct ProxyHit{distance:f32,triangle:u32,found:bool,}
${BOUNCE_NODE_WGSL}
/** Möller–Trumbore, two-sided: a wall has no front or back for light. */
fn triangleHit(index:u32,origin:vec3f,direction:vec3f,limit:f32)->f32{
 let a=proxyVertex(index,0u);
 let edge0=proxyVertex(index,1u)-a;
 let edge1=proxyVertex(index,2u)-a;
 let perpendicular=cross(direction,edge1);
 let determinant=dot(edge0,perpendicular);
 if(abs(determinant)<1e-12){return limit;}
 let inverse=1.0/determinant;
 let offset=origin-a;
 let u=dot(offset,perpendicular)*inverse;
 if(u<0.0||u>1.0){return limit;}
 let across=cross(offset,edge0);
 let v=dot(direction,across)*inverse;
 if(v<0.0||u+v>1.0){return limit;}
 let distance=dot(edge1,across)*inverse;
 if(distance<=1e-4||distance>=limit){return limit;}
 return distance;
}
/** The nearest triangle hit, or nothing. The direction is assumed normalized. */
fn traceProxy(origin:vec3f,direction:vec3f,limit:f32)->ProxyHit{
 var best=ProxyHit(limit,0u,false);
 if(proxyNodeCount()==0u){return best;}
 let inverse=rayInverse(direction);
 var stack:array<u32,${BOUNCE_SETTINGS.traversalStack}>;
 var depth=0u;
 var node=0u;
 for(var step=0u;step<TRAVERSAL_STEPS;step++){
  let frame=nodeBox(node);
  if(boxEntry(frame,origin,inverse,best.distance)>best.distance){
   if(depth==0u){break;}
   depth--;node=stack[depth];continue;
  }
  var nearest=0u;
  var nearestSpan=best.distance+1.0;
  for(var slot=0u;slot<CHILDREN;slot++){
   let child=proxyChild(node,slot,frame);
   if(!child.present){continue;}
   let span=boxEntry(child.box,origin,inverse,best.distance);
   if(span>best.distance){continue;}
   if(child.count>0u){
    for(var k=0u;k<LEAF_TRIANGLES;k++){
     if(k>=child.count){break;}
     let index=child.offset+k;
     let distance=triangleHit(index,origin,direction,best.distance);
     if(distance<best.distance){best=ProxyHit(distance,index,true);}
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
 return best;
}
/** True as soon as a triangle cuts the segment: a shadow does not need the nearest. */
fn proxyBlocked(origin:vec3f,direction:vec3f,limit:f32)->bool{
 if(proxyNodeCount()==0u){return false;}
 let inverse=rayInverse(direction);
 var stack:array<u32,${BOUNCE_SETTINGS.traversalStack}>;
 var depth=0u;
 var node=0u;
 for(var step=0u;step<TRAVERSAL_STEPS;step++){
  let frame=nodeBox(node);
  var descend=false;
  var next=0u;
  if(boxEntry(frame,origin,inverse,limit)<=limit){
   for(var slot=0u;slot<CHILDREN;slot++){
    let child=proxyChild(node,slot,frame);
    if(!child.present){continue;}
    if(boxEntry(child.box,origin,inverse,limit)>limit){continue;}
    if(child.count>0u){
     for(var k=0u;k<LEAF_TRIANGLES;k++){
      if(k>=child.count){break;}
      if(triangleHit(child.offset+k,origin,direction,limit)<limit){return true;}
     }
     continue;
    }
    if(!descend){descend=true;next=child.offset;}
    else if(depth<STACK_DEPTH){stack[depth]=child.offset;depth++;}
   }
  }
  if(descend){node=next;continue;}
  if(depth==0u){break;}
  depth--;node=stack[depth];
 }
 return false;
}`;
