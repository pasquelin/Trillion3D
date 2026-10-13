import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import {
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
} from '../../../sdk-core/src/index.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { byteOf } from '../../../math/src/wgsl/integer.ts'

/** The names a wide tree's reader is written under: its two functions, the storage variable whose
 *  `boundsWord`, `childrenWord` and `words` hold the tree, and the function reading a word as a float. */
export type WideNodeNames = { box: string; child: string; source: string; float: string }

/**
 * The two reads of a wide tree — a node's exact bounds and the dequantized box of one of its
 * children —, written once for every tree of the engine: the arena of the meshes' and cuts' proxies
 * (`runtimeSceneWgsl.ts`). The node is the rank of the node in the tree's own columns.
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
/** A child of a node, dequantized in its parent's bounds. */
fn ${child}(node:u32,slot:u32,frame:Box)->ProxyChild{
 let base=${source}.childrenWord+node*NODE_WORDS+slot*CHILD_WORDS;
 let low=${source}.words[base];
 let high=${source}.words[base+1u];
 let span=(frame.high-frame.low)/255.0;
 return ProxyChild(
  Box(frame.low+span*vec3f(f32(byteOf(low,0u)),f32(byteOf(low,1u)),f32(byteOf(low,2u))),
      frame.low+span*vec3f(f32(byteOf(low,3u)),f32(byteOf(high,0u)),f32(byteOf(high,1u)))),
  ${source}.words[base+2u],byteOf(high,2u),(high>>24u)!=0u);
}`

/**
 * What a proxy node carries, and how a ray reads it: a node's exact bounds and the four quantized boxes of
 * its children.
 *
 * A child box fits in six bytes, written in the parent's bounds and rounded outward by
 * the compiler: dequantized, it always contains what it contained, so no triangle
 * disappears from a ray. The presence bit is the only way to skip an empty slot — an
 * inverted box would not suffice, the plane test only sees mins and maxes.
 */
export const WIDE_NODE_WGSL = wgslBlock(
  'WIDE_NODE_WGSL',
  [byteOf],
  `
${wgslConsts({
  NODE_FLOATS: PROXY_NODE_FLOATS,
  NODE_WORDS: PROXY_NODE_WORDS,
  CHILD_WORDS: PROXY_CHILD_WORDS,
})}
struct Box{low:vec3f,high:vec3f,}
struct ProxyChild{box:Box,offset:u32,count:u32,present:bool,}`,
)
