import { PROXY_GROUP_OWNED } from '../../../sdk-core/src/scene/core/proxyLeaves.ts'

/** Owner a hit on a posed leaf reports: its triangle stands at its pose, no owner word is read. */
const PROXY_POSED_OWNER = 0xfffffffe

/** Owner transforms share the traversal binding, never one expanded geometry per instance. Each
 *  triangle is posed or owned by its leaf (`proxyLeaves.ts`); a ray carries that as its owner, so
 *  every helper below tests the same thing: `owner==PROXY_POSED`. */
export const PROXY_OWNER_WGSL = `
const PROXY_POSED:u32=${PROXY_POSED_OWNER}u;
const PROXY_GROUP_OWNED:u32=${PROXY_GROUP_OWNED}u;
/** Visited nodes per ray: the built tree's bound plus every node a refit let into a ray. */
fn proxySteps()->u32{return proxy.steps;}
/** Owners a leaf triangle is tested under. A posed leaf's triangle is tested once as it stands
 *  and reads no owner word: its pose is already written. */
fn proxyOwners(triangle:u32,owned:bool)->vec2u{
 if(!owned){return vec2u(PROXY_POSED,PROXY_POSED+1u);}
 let group=proxy.words[proxy.groupsWord+triangle]&~PROXY_GROUP_OWNED;
 return vec2u(proxy.words[proxy.rangesWord+group],proxy.words[proxy.rangesWord+group+1u]);
}
/** The owner a pass walking triangles evaluates one at: the first of an owned triangle's group
 *  (all agree once it can settle), or the posed triangle itself. */
fn proxyFirstOwner(triangle:u32)->u32{
 let group=proxy.words[proxy.groupsWord+triangle];
 if((group&PROXY_GROUP_OWNED)==0u){return PROXY_POSED;}
 return proxy.words[proxy.rangesWord+(group&~PROXY_GROUP_OWNED)];
}
fn proxyOwnerVertex(triangle:u32,vertex:u32,owner:u32)->vec3f{
 let p=proxyVertex(triangle,vertex);
 if(owner==PROXY_POSED){return p;}
 let source=proxy.words[proxy.ownersWord+owner*2u];
 let base=proxy.transformsWord+source*16u;
 var result=vec3f(0.0);
 for(var axis=0u;axis<3u;axis++){
  result[axis]=proxyFloat(base+axis)*p.x+proxyFloat(base+4u+axis)*p.y+
   proxyFloat(base+8u+axis)*p.z+proxyFloat(base+12u+axis);
 }
 return result;
}
fn proxyOwnerNormal(triangle:u32,owner:u32)->vec3f{
 let a=proxyOwnerVertex(triangle,0u,owner);
 return normalize(cross(proxyOwnerVertex(triangle,1u,owner)-a,proxyOwnerVertex(triangle,2u,owner)-a));
}
fn proxyOwnerCentre(triangle:u32,owner:u32)->vec3f{
 return (proxyOwnerVertex(triangle,0u,owner)+proxyOwnerVertex(triangle,1u,owner)+proxyOwnerVertex(triangle,2u,owner))/3.0;
}
/** An owner's albedo; a posed hit reads the surface cache instead and never asks. */
fn proxyOwnerAlbedo(owner:u32)->vec3f{
 if(owner==PROXY_POSED){return vec3f(0.0);}
 let packed=proxy.words[proxy.ownersWord+owner*2u+1u];
 return vec3f(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u))/255.0;
}`
