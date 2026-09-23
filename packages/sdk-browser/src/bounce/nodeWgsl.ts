import {
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
} from '../../../sdk-core/src/index.ts';

/**
 * The resident proxy lives in **a single storage buffer**, header included.
 *
 * Three separate columns — triangles, node bounds, children — plus the distant-shadow
 * settings block made four bindings. Deferred resolve just held them; the blend pass,
 * which already binds seven storage buffers at its fragment stage, had only one free
 * of the eight the spec guarantees. That missing binding, and nothing else, is what
 * denied transparents the sun shadow beyond the last cascade.
 *
 * One binding therefore carries everything: a twelve-word header, then the three
 * columns back to back, whose start ranks are written in the header. Float columns
 * are reread by `bitcast` — a word is a word, and the proxy is neither copied nor
 * converted. Albedo stays aside: a shadow looks for an occluder, not a colour, and
 * the column that carries it is one more binding that only bounced light asks for.
 *
 * The header is the only part written after prepare: ray settings, the count flag
 * and the two counters. The columns themselves are written once and never move.
 */
/** Header words, before the first column. */
export const PROXY_HEADER_WORDS = 12;
export const PROXY_HEADER_BYTES = PROXY_HEADER_WORDS * 4;
/** The four shadow-ray settings, at the front: offset, start, range, presence. */
export const PROXY_PARAM_FLOATS = 4;
/** The count flag, then the two counters of the counted frame, in bytes from the start. */
export const PROXY_COUNTING_OFFSET = PROXY_PARAM_FLOATS * 4;
export const PROXY_COUNT_OFFSET = PROXY_COUNTING_OFFSET + 4;
export const PROXY_COUNTS = 2;
/** Rank of the first layout word: node count, then the three start ranks. */
export const PROXY_LAYOUT_WORD = 7;

/**
 * Declaration of the resident proxy at the binding slot the calling pass gives it. The three
 * passes that traverse it — probes, surface cache, and the two lighting passes — read the
 * same structure at the same word ranks: one way to describe the proxy.
 *
 * `writable` says whether the pass may write the two count counters, and nothing else: the
 * rest of the header and the three columns are read on both sides. A pass that does not
 * count takes the read-only declaration, where the counters become ordinary `u32` — an
 * `atomic` is not declared in a `read` binding. This is not a style preference: on a
 * tile-based GPU, **a storage binding writable from the fragment stage forbids early
 * depth rejection** for the whole pipeline, because the side effect must happen even
 * when depth would discard the fragment. The blend pass pays that early rejection in
 * full; it therefore takes the read-only declaration.
 */
export const residentProxyWgsl = (binding: number, writable = true) => `
struct ResidentProxy{
 offsetMetres:f32,startMetres:f32,maxMetres:f32,present:f32,
 counting:u32,${writable ? 'tested:atomic<u32>,blocked:atomic<u32>' : 'tested:u32,blocked:u32'},nodeCount:u32,
 trianglesWord:u32,boundsWord:u32,childrenWord:u32,pad:u32,
 words:array<u32>,
}
@group(0) @binding(${binding}) var<storage,${writable ? 'read_write' : 'read'}> proxy:ResidentProxy;`;

/**
 * What a proxy node carries, and how a ray reads it: a triangle's vertices, a node's exact
 * bounds and the four quantized boxes of its children. Albedo is aside, lower down: a
 * shadow has no use for the colour of what carries it, and the column that carries it is
 * one more storage buffer to bind.
 *
 * A child box fits in six bytes, written in the parent's bounds and rounded outward by
 * the compiler: dequantized, it always contains what it contained, so no triangle
 * disappears from a ray. The presence bit is the only way to skip an empty slot — an
 * inverted box would not suffice, the plane test only sees mins and maxes.
 */
/** Slab ray/box traversal, guard at 1e-20. `../lighting/shader/intersections.ts` writes the
 *  same in GLSL with a 1e-19 guard: different thresholds, different languages, nothing to share. */
export const BOUNCE_NODE_WGSL = `
const NODE_FLOATS:u32=${PROXY_NODE_FLOATS}u;
const NODE_WORDS:u32=${PROXY_NODE_WORDS}u;
const CHILD_WORDS:u32=${PROXY_CHILD_WORDS}u;
struct Box{low:vec3f,high:vec3f,}
struct ProxyChild{box:Box,offset:u32,count:u32,present:bool,}
/** Tree nodes: zero when the cache carries none, hence a ray that hits nothing. */
fn proxyNodeCount()->u32{return proxy.nodeCount;}
/** A column word reread as the float it carries: no copy, no conversion. */
fn proxyFloat(word:u32)->f32{return bitcast<f32>(proxy.words[word]);}
/** A vertex of a proxy triangle, in world coordinates. */
fn proxyVertex(index:u32,vertex:u32)->vec3f{
 let base=proxy.trianglesWord+index*TRIANGLE_FLOATS+vertex*3u;
 return vec3f(proxyFloat(base),proxyFloat(base+1u),proxyFloat(base+2u));
}
/** Geometric normal of a proxy triangle: the proxy stores no normal. */
fn proxyNormal(index:u32)->vec3f{
 let a=proxyVertex(index,0u);
 return normalize(cross(proxyVertex(index,1u)-a,proxyVertex(index,2u)-a));
}
/** A triangle's centroid: the point where the surface cache evaluates its texel. */
fn proxyCentre(index:u32)->vec3f{
 return (proxyVertex(index,0u)+proxyVertex(index,1u)+proxyVertex(index,2u))/3.0;
}
/** Inverse of a direction, with no division in the loop and no infinity on a zero axis. */
fn rayInverse(direction:vec3f)->vec3f{
 return vec3f(1.0)/select(direction,vec3f(1e-20),abs(direction)<vec3f(1e-20));
}
/** Exact bounds of a node, which also serve as the frame for its children's boxes. */
fn nodeBox(node:u32)->Box{
 let base=proxy.boundsWord+node*NODE_FLOATS;
 return Box(vec3f(proxyFloat(base),proxyFloat(base+1u),proxyFloat(base+2u)),
            vec3f(proxyFloat(base+3u),proxyFloat(base+4u),proxyFloat(base+5u)));
}
/** Entry distance of a ray into a box, or beyond the limit if it misses. */
fn boxEntry(box:Box,origin:vec3f,inverse:vec3f,limit:f32)->f32{
 let first=(box.low-origin)*inverse;
 let second=(box.high-origin)*inverse;
 let near=min(first,second);
 let far=max(first,second);
 let entry=max(max(near.x,near.y),max(near.z,0.0));
 let exit=min(min(far.x,far.y),min(far.z,limit));
 return select(limit+1.0,entry,entry<=exit);
}
/** A child of a node, dequantized in its parent's bounds. */
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
 * Linear albedo of a proxy triangle, unpacked from its four bytes. Split from the traversal:
 * only bounced light reads a colour, and a shader that only looks for an occluder then has
 * neither the albedo column to declare nor its buffer to bind.
 */
export const PROXY_ALBEDO_WGSL = `
fn proxyAlbedoOf(index:u32)->vec3f{
 let packed=proxyAlbedo[index];
 return vec3f(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u))/255.0;
}`;
