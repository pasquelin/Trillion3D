/** Owner transforms share the traversal binding, never one expanded geometry per instance. */
export const PROXY_OWNER_WGSL = `
/** Visited nodes per ray: the still bound, plus once an owner moved the nodes refit widened. */
fn proxySteps()->u32{return select(TRAVERSAL_STEPS,proxy.motionSteps,proxy.dynamic!=0u);}
/** Owners a leaf triangle is tested under. A still proxy tests its canonical triangle once and
 *  reads no owner word: the pose never changes it. */
fn proxyOwners(triangle:u32)->vec2u{
 if(proxy.dynamic==0u){return vec2u(0u,1u);}
 let group=proxy.words[proxy.groupsWord+triangle];
 return vec2u(proxy.words[proxy.rangesWord+group],proxy.words[proxy.rangesWord+group+1u]);
}
fn proxyOwnerVertex(triangle:u32,vertex:u32,owner:u32)->vec3f{
 let p=proxyVertex(triangle,vertex);
 if(proxy.dynamic==0u){return p;}
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
fn proxyOwnerAlbedo(owner:u32)->vec3f{
 let packed=proxy.words[proxy.ownersWord+owner*2u+1u];
 return vec3f(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u))/255.0;
}`;
