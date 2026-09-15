import { BOUNCE_SETTINGS, PROXY_TRIANGLE_FLOATS } from '../sdk-core/index.ts';

/**
 * La traversée du proxy résident : un BVH aplati, un saut par nœud, et l'intersection de
 * Möller–Trumbore sur les triangles d'une feuille.
 *
 * Deux bornes connues avant l'image (X2) : le nombre de nœuds visités et le nombre de triangles
 * d'une feuille. Aucune pile, aucune récursion — un nœud interne descend sur le suivant, un nœud
 * rejeté ou une feuille finie saute sur `escape`, qui pointe toujours plus loin, ce que le lecteur
 * du cache a déjà vérifié.
 */
export const BOUNCE_TRACE_WGSL = `
const TRAVERSAL_STEPS:u32=${BOUNCE_SETTINGS.traversalSteps}u;
const LEAF_TRIANGLES:u32=${BOUNCE_SETTINGS.proxyLeafTriangles}u;
const TRIANGLE_FLOATS:u32=${PROXY_TRIANGLE_FLOATS}u;
struct ProxyHit{distance:f32,triangle:u32,found:bool,}
/** Un sommet d'un triangle du proxy, en coordonnées monde. */
fn proxyVertex(index:u32,vertex:u32)->vec3f{
 let base=index*TRIANGLE_FLOATS+vertex*3u;
 return vec3f(proxyTriangles[base],proxyTriangles[base+1u],proxyTriangles[base+2u]);
}
/** La normale géométrique d'un triangle du proxy : le proxy ne stocke aucune normale. */
fn proxyNormal(index:u32)->vec3f{
 let a=proxyVertex(index,0u);
 let edge0=proxyVertex(index,1u)-a;
 let edge1=proxyVertex(index,2u)-a;
 return normalize(cross(edge0,edge1));
}
/** L'albédo linéaire d'un triangle, dépaqueté de ses quatre octets. */
fn proxyAlbedoOf(index:u32)->vec3f{
 let packed=proxyAlbedo[index];
 return vec3f(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u))/255.0;
}
/** La boîte d'un nœud contre le rayon : les deux plans par axe, sans division dans la boucle. */
fn slabHit(node:u32,origin:vec3f,inverse:vec3f,limit:f32)->bool{
 let base=node*6u;
 let low=vec3f(proxyNodeBounds[base],proxyNodeBounds[base+1u],proxyNodeBounds[base+2u]);
 let high=vec3f(proxyNodeBounds[base+3u],proxyNodeBounds[base+4u],proxyNodeBounds[base+5u]);
 let first=(low-origin)*inverse;
 let second=(high-origin)*inverse;
 let near=min(first,second);
 let far=max(first,second);
 let entry=max(max(near.x,near.y),max(near.z,0.0));
 let exit=min(min(far.x,far.y),min(far.z,limit));
 return entry<=exit;
}
/** Möller–Trumbore, double face : un mur n'a pas d'endroit ni d'envers pour la lumière. */
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
/** Le plus proche triangle touché, ou rien. La direction est supposée normalisée. */
fn traceProxy(origin:vec3f,direction:vec3f,limit:f32)->ProxyHit{
 var best=ProxyHit(limit,0u,false);
 let count=arrayLength(&proxyNodeLinks)/3u;
 if(count==0u){return best;}
 let inverse=vec3f(1.0)/select(direction,vec3f(1e-20),abs(direction)<vec3f(1e-20));
 var node=0u;
 for(var step=0u;step<TRAVERSAL_STEPS;step++){
  if(node>=count){break;}
  let link=node*3u;
  if(!slabHit(node,origin,inverse,best.distance)){node=proxyNodeLinks[link];continue;}
  let triangles=proxyNodeLinks[link+2u];
  if(triangles==0u){node=node+1u;continue;}
  let first=proxyNodeLinks[link+1u];
  for(var slot=0u;slot<LEAF_TRIANGLES;slot++){
   if(slot>=triangles){break;}
   let index=first+slot;
   let distance=triangleHit(index,origin,direction,best.distance);
   if(distance<best.distance){best=ProxyHit(distance,index,true);}
  }
  node=proxyNodeLinks[link];
 }
 return best;
}
/** Vrai dès qu'un triangle coupe le segment : une ombre n'a pas besoin du plus proche. */
fn proxyBlocked(origin:vec3f,direction:vec3f,limit:f32)->bool{
 let count=arrayLength(&proxyNodeLinks)/3u;
 if(count==0u){return false;}
 let inverse=vec3f(1.0)/select(direction,vec3f(1e-20),abs(direction)<vec3f(1e-20));
 var node=0u;
 for(var step=0u;step<TRAVERSAL_STEPS;step++){
  if(node>=count){break;}
  let link=node*3u;
  if(!slabHit(node,origin,inverse,limit)){node=proxyNodeLinks[link];continue;}
  let triangles=proxyNodeLinks[link+2u];
  if(triangles==0u){node=node+1u;continue;}
  let first=proxyNodeLinks[link+1u];
  for(var slot=0u;slot<LEAF_TRIANGLES;slot++){
   if(slot>=triangles){break;}
   if(triangleHit(first+slot,origin,direction,limit)<limit){return true;}
  }
  node=proxyNodeLinks[link];
 }
 return false;
}`;
