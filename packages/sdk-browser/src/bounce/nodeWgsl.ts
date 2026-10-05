import { PROXY_LEAF_OWNED } from '../../../sdk-core/src/scene/core/proxyLeaves.ts';
import {
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
} from '../../../sdk-core/src/index.ts';

/** One storage binding holds shadow settings, canonical triangles, refitted BVH columns,
 *  owner ranges and transforms. Only the bounds, quantized children and owner poses change. */
/** Rank of the first layout word: node count, then the three start ranks. */
export const PROXY_LAYOUT_WORD = 4;
/** Revision of the owner poses. */
export const PROXY_REVISION_WORD = 12;
/** Visited nodes a ray may take, derived from the tree (`proxy.ts`), after the revision word. */
export const PROXY_STEPS_WORD = PROXY_REVISION_WORD + 1;

/** Binding rank of the resident proxy in the deferred-resolution layout. */
export const RESIDENT_PROXY_BINDING = 13;

/**
 * Declaration of the resident proxy at the binding slot the calling pass gives it. The three
 * passes that traverse it — probes, surface cache, and the two lighting passes — read the
 * same structure at the same word ranks: one way to describe the proxy.
 *
 * The binding is read-only for every pass: nothing in the header or the columns is written from
 * a shader. This is not a style preference: on a tile-based GPU, **a storage binding writable
 * from the fragment stage forbids early depth rejection** for the whole pipeline, because the
 * side effect must happen even when depth would discard the fragment.
 */
export const residentProxyWgsl = (binding: number) => `
struct ResidentProxy{
 offsetMetres:f32,startMetres:f32,maxMetres:f32,present:f32,
 nodeCount:u32,
 trianglesWord:u32,boundsWord:u32,childrenWord:u32,
 groupsWord:u32,rangesWord:u32,ownersWord:u32,transformsWord:u32,
 revision:u32,steps:u32,pad1:u32,pad2:u32,pad3:u32,
 words:array<u32>,
}
@group(0) @binding(${binding}) var<storage,read> proxy:ResidentProxy;`;

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
/** Slab ray/box traversal, guard at 1e-20. */
export const BOUNCE_NODE_WGSL = `
const NODE_FLOATS:u32=${PROXY_NODE_FLOATS}u;
const NODE_WORDS:u32=${PROXY_NODE_WORDS}u;
const CHILD_WORDS:u32=${PROXY_CHILD_WORDS}u;
struct Box{low:vec3f,high:vec3f,}
struct ProxyChild{box:Box,offset:u32,count:u32,present:bool,owned:bool,}
/** Tree nodes: zero when the cache carries none, hence a ray that hits nothing. */
fn proxyNodeCount()->u32{return proxy.nodeCount;}
/** A column word reread as the float it carries: no copy, no conversion. */
fn proxyFloat(word:u32)->f32{return bitcast<f32>(proxy.words[word]);}
/** A vertex as the column holds it: at its pose on a posed leaf, canonical on an owned one. */
fn proxyVertex(index:u32,vertex:u32)->vec3f{
 let base=proxy.trianglesWord+index*TRIANGLE_FLOATS+vertex*3u;
 return vec3f(proxyFloat(base),proxyFloat(base+1u),proxyFloat(base+2u));
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
/** A child of a node, dequantized in its parent's bounds. An owned leaf holds canonical
 *  triangles traced under their owners' poses, as proxyLeaves.ts writes. */
fn proxyChild(node:u32,slot:u32,frame:Box)->ProxyChild{
 let base=proxy.childrenWord+node*NODE_WORDS+slot*CHILD_WORDS;
 let low=proxy.words[base];
 let high=proxy.words[base+1u];
 let span=(frame.high-frame.low)/255.0;
 return ProxyChild(
  Box(frame.low+span*vec3f(f32(low&255u),f32((low>>8u)&255u),f32((low>>16u)&255u)),
      frame.low+span*vec3f(f32((low>>24u)&255u),f32(high&255u),f32((high>>8u)&255u))),
  proxy.words[base+2u],(high>>16u)&255u,(high>>24u)!=0u,(high&${PROXY_LEAF_OWNED}u)!=0u);
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
