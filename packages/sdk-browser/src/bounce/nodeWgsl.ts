import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { DEFERRED_BINDINGS } from '../lighting/deferred/bindings.ts'
import { PROXY_LEAF_OWNED } from '../../../sdk-core/src/scene/core/proxyLeaves.ts'
import {
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
} from '../../../sdk-core/src/index.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { byteOf } from '../../../math/src/wgsl/integer.ts'
import { unorm8x3 } from '../../../math/src/wgsl/color.ts'

/** One storage binding holds shadow settings, canonical triangles, refitted BVH columns,
 *  owner ranges and transforms. Only the bounds, quantized children and owner poses change. */
/** Rank of the first layout word: node count, then the three start ranks. */
export const PROXY_LAYOUT_WORD = 4
/** Revision of the owner poses. */
export const PROXY_REVISION_WORD = 12
/** Visited nodes a ray may take, derived from the tree (`proxy.ts`), after the revision word. */
export const PROXY_STEPS_WORD = PROXY_REVISION_WORD + 1

/** Binding rank of the resident proxy in the deferred-resolution layout. */
export const RESIDENT_PROXY_BINDING = DEFERRED_BINDINGS.proxy

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
export const residentProxyWgsl = (binding: number) =>
  wgslBlock(
    `residentProxyWgsl(${binding})`,
    [],
    `
struct ResidentProxy{
 offsetMetres:f32,startMetres:f32,maxMetres:f32,present:f32,
 nodeCount:u32,
 trianglesWord:u32,boundsWord:u32,childrenWord:u32,
 groupsWord:u32,rangesWord:u32,ownersWord:u32,transformsWord:u32,
 revision:u32,steps:u32,pad1:u32,pad2:u32,pad3:u32,
 words:array<u32>,
}
@group(0) @binding(${binding}) var<storage,read> proxy:ResidentProxy;`,
  )

/** The names a wide tree's reader is written under: its two functions, the storage variable whose
 *  `boundsWord`, `childrenWord` and `words` hold the tree, and the function reading a word as a float. */
export type WideNodeNames = { box: string; child: string; source: string; float: string }

/**
 * The two reads of a wide tree — a node's exact bounds and the dequantized box of one of its
 * children —, written once for every tree of the engine: the resident proxy's (`BOUNCE_NODE_WGSL`) and the
 * arena of the run-time cuts' (`runtimeTraceWgsl.ts`) are laid out alike. The node is the rank of the
 * node in the tree's own columns.
 */
export const wideNodeFns = ({
  box,
  child,
  source,
  float,
}: WideNodeNames) => `/** Exact bounds of a node, which also serve as the frame for its children's boxes. */
fn ${box}(node:u32)->Box{
 let base=${source}.boundsWord+node*NODE_FLOATS;
 return Box(vec3f(${float}(base),${float}(base+1u),${float}(base+2u)),
            vec3f(${float}(base+3u),${float}(base+4u),${float}(base+5u)));
}
/** A child of a node, dequantized in its parent's bounds. An owned leaf holds canonical
 *  triangles traced under their owners' poses, as proxyLeaves.ts writes. */
fn ${child}(node:u32,slot:u32,frame:Box)->ProxyChild{
 let base=${source}.childrenWord+node*NODE_WORDS+slot*CHILD_WORDS;
 let low=${source}.words[base];
 let high=${source}.words[base+1u];
 let span=(frame.high-frame.low)/255.0;
 return ProxyChild(
  Box(frame.low+span*vec3f(f32(byteOf(low,0u)),f32(byteOf(low,1u)),f32(byteOf(low,2u))),
      frame.low+span*vec3f(f32(byteOf(low,3u)),f32(byteOf(high,0u)),f32(byteOf(high,1u)))),
  ${source}.words[base+2u],byteOf(high,2u),(high>>24u)!=0u,(high&${PROXY_LEAF_OWNED}u)!=0u);
}`

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
export const BOUNCE_NODE_WGSL = wgslBlock(
  'BOUNCE_NODE_WGSL',
  [byteOf],
  `
${wgslConsts({
  NODE_FLOATS: PROXY_NODE_FLOATS,
  NODE_WORDS: PROXY_NODE_WORDS,
  CHILD_WORDS: PROXY_CHILD_WORDS,
})}
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
${wideNodeFns({ box: 'nodeBox', child: 'proxyChild', source: 'proxy', float: 'proxyFloat' })}`,
)

/**
 * Linear albedo of a proxy triangle, unpacked from its four bytes. Split from the traversal:
 * only bounced light reads a colour, and a shader that only looks for an occluder then has
 * neither the albedo column to declare nor its buffer to bind.
 */
export const PROXY_ALBEDO_WGSL = wgslBlock(
  'PROXY_ALBEDO_WGSL',
  [unorm8x3],
  `
fn proxyAlbedoOf(index:u32)->vec3f{
 return unorm8x3(proxyAlbedo[index]);
}`,
)
