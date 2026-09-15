import { PROXY_CHILD_WORDS, PROXY_NODE_FLOATS, PROXY_NODE_WORDS } from '../sdk-core/index.ts';

/**
 * Le proxy résident tient dans **un seul tampon de stockage**, entête compris.
 *
 * Trois colonnes séparées — triangles, bornes de nœuds, enfants — plus le bloc de réglages de
 * l'ombre lointaine faisaient quatre liaisons. La résolution différée les tenait tout juste ; la
 * passe de mélange, qui lie déjà sept tampons de stockage à son étage de fragments, n'en avait
 * qu'une de libre sur les huit que la norme garantit. C'est cette liaison manquante, et rien
 * d'autre, qui privait les transparents de l'ombre du soleil au-delà de la dernière cascade.
 *
 * Une liaison porte donc tout : un entête de douze mots, puis les trois colonnes bout à bout, dont
 * les rangs de départ sont écrits dans l'entête. Les colonnes de flottants se relisent par
 * `bitcast` — un mot est un mot, et le proxy n'est ni recopié ni converti. L'albédo reste à part :
 * une ombre cherche un occulteur, pas une couleur, et la colonne qui la porte est une liaison de
 * plus que seule la lumière qui rebondit demande.
 *
 * L'entête est la seule part écrite après la préparation : les réglages du rayon, le drapeau de
 * relevé et les deux compteurs. Les colonnes, elles, sont écrites une fois et ne bougent plus.
 */
/** Mots de l'entête, avant la première colonne. */
export const PROXY_HEADER_WORDS = 12;
export const PROXY_HEADER_BYTES = PROXY_HEADER_WORDS * 4;
/** Les quatre réglages du rayon d'ombre, en tête : décalage, départ, portée, présence. */
export const PROXY_PARAM_FLOATS = 4;
/** Le drapeau de relevé, puis les deux compteurs de l'image relevée, en octets depuis le début. */
export const PROXY_COUNTING_OFFSET = PROXY_PARAM_FLOATS * 4;
export const PROXY_COUNT_OFFSET = PROXY_COUNTING_OFFSET + 4;
export const PROXY_COUNTS = 2;
/** Le rang du premier mot de disposition : nombre de nœuds, puis les trois rangs de départ. */
export const PROXY_LAYOUT_WORD = 7;

/**
 * La déclaration du proxy résident au rang de liaison que la passe appelante lui donne. Les trois
 * passes qui le traversent — sondes, cache de surfaces, et les deux passes qui éclairent — lisent
 * la même structure aux mêmes rangs de mots : une seule façon de décrire le proxy.
 *
 * L'accès est `read_write` partout : les deux compteurs sont des `atomic`, qu'une liaison en
 * lecture seule ne peut pas déclarer. Les passes qui ne comptent rien n'y écrivent jamais.
 */
export const residentProxyWgsl = (binding: number) => `
struct ResidentProxy{
 offsetMetres:f32,startMetres:f32,maxMetres:f32,present:f32,
 counting:u32,tested:atomic<u32>,blocked:atomic<u32>,nodeCount:u32,
 trianglesWord:u32,boundsWord:u32,childrenWord:u32,pad:u32,
 words:array<u32>,
}
@group(0) @binding(${binding}) var<storage,read_write> proxy:ResidentProxy;`;

/**
 * Ce qu'un nœud du proxy porte, et comment un rayon le lit : les sommets d'un triangle, les bornes
 * exactes d'un nœud et les quatre boîtes quantifiées de ses enfants. L'albédo est à part, plus bas :
 * une ombre n'a que faire de la couleur de ce qui la porte, et la colonne qui la porte est un tampon
 * de stockage de plus à lier.
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
fn proxyNodeCount()->u32{return proxy.nodeCount;}
/** Un mot d'une colonne relu comme le flottant qu'il porte : aucune copie, aucune conversion. */
fn proxyFloat(word:u32)->f32{return bitcast<f32>(proxy.words[word]);}
/** Un sommet d'un triangle du proxy, en coordonnées monde. */
fn proxyVertex(index:u32,vertex:u32)->vec3f{
 let base=proxy.trianglesWord+index*TRIANGLE_FLOATS+vertex*3u;
 return vec3f(proxyFloat(base),proxyFloat(base+1u),proxyFloat(base+2u));
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
/** L'inverse d'une direction, sans division dans la boucle et sans infini sur un axe nul. */
fn rayInverse(direction:vec3f)->vec3f{
 return vec3f(1.0)/select(direction,vec3f(1e-20),abs(direction)<vec3f(1e-20));
}
/** Les bornes exactes d'un nœud, qui servent aussi de repère aux boîtes de ses enfants. */
fn nodeBox(node:u32)->Box{
 let base=proxy.boundsWord+node*NODE_FLOATS;
 return Box(vec3f(proxyFloat(base),proxyFloat(base+1u),proxyFloat(base+2u)),
            vec3f(proxyFloat(base+3u),proxyFloat(base+4u),proxyFloat(base+5u)));
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
 let base=proxy.childrenWord+node*NODE_WORDS+slot*CHILD_WORDS;
 let low=proxy.words[base];
 let high=proxy.words[base+1u];
 let span=(frame.high-frame.low)/255.0;
 return ProxyChild(
  Box(frame.low+span*vec3f(f32(low&255u),f32((low>>8u)&255u),f32((low>>16u)&255u)),
      frame.low+span*vec3f(f32((low>>24u)&255u),f32(high&255u),f32((high>>8u)&255u))),
  proxy.words[base+2u],(high>>16u)&255u,(high>>24u)!=0u);
}`;

/**
 * L'albédo linéaire d'un triangle du proxy, dépaqueté de ses quatre octets. Séparé de la traversée :
 * seule la lumière qui rebondit lit une couleur, et un nuanceur qui ne fait que chercher un
 * occulteur n'a alors ni la colonne d'albédo à déclarer ni son tampon à lier.
 */
export const PROXY_ALBEDO_WGSL = `
fn proxyAlbedoOf(index:u32)->vec3f{
 let packed=proxyAlbedo[index];
 return vec3f(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u))/255.0;
}`;
