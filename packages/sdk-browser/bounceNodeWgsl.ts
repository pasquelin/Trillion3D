import { PROXY_CHILD_WORDS, PROXY_NODE_FLOATS, PROXY_NODE_WORDS } from '../sdk-core/index.ts';

/**
 * Ce qu'un nœud du proxy porte, et comment un rayon le lit : les sommets d'un triangle, son albédo,
 * les bornes exactes d'un nœud et les quatre boîtes quantifiées de ses enfants.
 *
 * Une boîte d'enfant tient sur six octets, écrits dans les bornes du parent et arrondis vers
 * l'extérieur par le compilateur : déquantifiée, elle contient toujours ce qu'elle contenait, donc
 * aucun triangle ne disparaît d'un rayon. Le bit de présence est le seul moyen d'écarter un
 * emplacement vide — une boîte inversée ne suffirait pas, le test des plans n'y voit que des
 * minimums et des maximums.
 */
export const BOUNCE_NODE_WGSL = `
const NODE_FLOATS:u32=${PROXY_NODE_FLOATS}u;
const NODE_WORDS:u32=${PROXY_NODE_WORDS}u;
const CHILD_WORDS:u32=${PROXY_CHILD_WORDS}u;
struct Box{low:vec3f,high:vec3f,}
struct ProxyChild{box:Box,offset:u32,count:u32,present:bool,}
/** Nœuds de l'arbre : zéro quand le cache n'en porte aucun, donc un rayon qui ne touche rien. */
fn proxyNodeCount()->u32{return arrayLength(&proxyNodeBounds)/NODE_FLOATS;}
/** Un sommet d'un triangle du proxy, en coordonnées monde. */
fn proxyVertex(index:u32,vertex:u32)->vec3f{
 let base=index*TRIANGLE_FLOATS+vertex*3u;
 return vec3f(proxyTriangles[base],proxyTriangles[base+1u],proxyTriangles[base+2u]);
}
/** La normale géométrique d'un triangle du proxy : le proxy ne stocke aucune normale. */
fn proxyNormal(index:u32)->vec3f{
 let a=proxyVertex(index,0u);
 return normalize(cross(proxyVertex(index,1u)-a,proxyVertex(index,2u)-a));
}
/** Le barycentre d'un triangle : le point où le cache de surfaces évalue sa maille. */
fn proxyCentre(index:u32)->vec3f{
 return (proxyVertex(index,0u)+proxyVertex(index,1u)+proxyVertex(index,2u))/3.0;
}
/** L'albédo linéaire d'un triangle, dépaqueté de ses quatre octets. */
fn proxyAlbedoOf(index:u32)->vec3f{
 let packed=proxyAlbedo[index];
 return vec3f(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u))/255.0;
}
/** L'inverse d'une direction, sans division dans la boucle et sans infini sur un axe nul. */
fn rayInverse(direction:vec3f)->vec3f{
 return vec3f(1.0)/select(direction,vec3f(1e-20),abs(direction)<vec3f(1e-20));
}
/** Les bornes exactes d'un nœud, qui servent aussi de repère aux boîtes de ses enfants. */
fn nodeBox(node:u32)->Box{
 let base=node*NODE_FLOATS;
 return Box(vec3f(proxyNodeBounds[base],proxyNodeBounds[base+1u],proxyNodeBounds[base+2u]),
            vec3f(proxyNodeBounds[base+3u],proxyNodeBounds[base+4u],proxyNodeBounds[base+5u]));
}
/** La distance d'entrée d'un rayon dans une boîte, ou au-delà de la limite s'il la manque. */
fn boxEntry(box:Box,origin:vec3f,inverse:vec3f,limit:f32)->f32{
 let first=(box.low-origin)*inverse;
 let second=(box.high-origin)*inverse;
 let near=min(first,second);
 let far=max(first,second);
 let entry=max(max(near.x,near.y),max(near.z,0.0));
 let exit=min(min(far.x,far.y),min(far.z,limit));
 return select(limit+1.0,entry,entry<=exit);
}
/** Un enfant d'un nœud, déquantifié dans les bornes de son parent. */
fn proxyChild(node:u32,slot:u32,frame:Box)->ProxyChild{
 let base=node*NODE_WORDS+slot*CHILD_WORDS;
 let low=proxyNodeChildren[base];
 let high=proxyNodeChildren[base+1u];
 let span=(frame.high-frame.low)/255.0;
 return ProxyChild(
  Box(frame.low+span*vec3f(f32(low&255u),f32((low>>8u)&255u),f32((low>>16u)&255u)),
      frame.low+span*vec3f(f32((low>>24u)&255u),f32(high&255u),f32((high>>8u)&255u))),
  proxyNodeChildren[base+2u],(high>>16u)&255u,(high>>24u)!=0u);
}`;
