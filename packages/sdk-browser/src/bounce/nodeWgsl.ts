import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import {
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
} from '../../../sdk-core/src/index.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { byteOf, isFiniteWord } from '../../../math/src/wgsl/integer.ts'
import { dDiv, dLess, dMul, dSub } from '../../../math/src/wgsl/double.ts'
import { dIsNan } from '../../../math/src/wgsl/doubleWords.ts'
import { fromF32, toF32 } from '../../../math/src/wgsl/f32.ts'

/** The names a wide tree's reader is written under: its two functions, the storage variable whose
 *  `boundsWord`, `childrenWord` and `words` hold the tree, and the function reading a word as a float. */
export type WideNodeNames = { box: string; child: string; source: string; float: string }

/**
 * The two reads of a wide tree — a node's exact bounds and the dequantized box of one of its
 * children —, written once for every tree of the engine: the arena of the meshes' and cuts' proxies
 * (`runtimeSceneWgsl.ts`) and the pose that fits a posed copy again (`runtimePoseWgsl.ts`). The node is the
 * rank of the node in the tree's own columns.
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

/**
 * THE BYTES OF A CHILD BOX, written by the codec's rule (`page-codec-wasm/src/proxy/wide.rs`, `pack`) to the
 * bit, for a tree the GPU fits again (`runtimePoseWgsl.ts`): per axis, the child's bound less the parent's
 * low, rounded to an `f32`, over the parent's span, times 255 — in doubles, as the codec computes it
 * (`math/src/wgsl/double.ts`) —, clamped to [0, 255], floored for a low bound and ceiled for a high one;
 * a flat or non-finite span the full width. One rule, one result: a copy the GPU posed holds the bytes the
 * compiler writes for the same box, and a dequantized box contains what it contained.
 */
export const WIDE_CHILD_PACK_WGSL = wgslBlock(
  'WIDE_CHILD_PACK_WGSL',
  [WIDE_NODE_WGSL, dSub, dMul, dDiv, dLess, dIsNan, fromF32, toF32, isFiniteWord],
  `
/** An \`f32\` as the double it widens to. */
fn wideDouble(x:f32)->vec2u{return fromF32(bitcast<u32>(x));}
/** The byte of bound \`value\` in the span \`span\` (a double) from \`low\`: floored, or ceiled where \`up\`. */
fn wideByte(value:f32,low:f32,span:vec2u,up:bool)->u32{
 let offset=fromF32(toF32(dSub(wideDouble(value),wideDouble(low))));
 let unit=dMul(dDiv(offset,span),wideDouble(255.0));
 if(dIsNan(unit)||dLess(unit,wideDouble(0.0))){return 0u;}
 if(dLess(wideDouble(255.0),unit)){return 255u;}
 // The f32 nearest the double passes no integer the double does not reach, by one step at most:
 // floor(f) is floor(unit) or one above it, ceil(f) is ceil(unit) or one below it.
 let f=bitcast<f32>(toF32(unit));
 if(up){
  var k=u32(ceil(f));
  if(dLess(wideDouble(f32(k)),unit)){k+=1u;}
  return k;
 }
 var k=u32(floor(f));
 if(dLess(unit,wideDouble(f32(k)))){k-=1u;}
 return k;
}
/** The three words of the child \`child\` of a node of exact bounds \`frame\`: its box on eight bits an
 *  axis and bound, its \`count\` triangles (none for an inner child), the presence bit and its link. */
fn wideChildPack(frame:Box,child:Box,count:u32,offset:u32)->vec3u{
 var low=vec3u(0u);
 var high=vec3u(255u);
 for(var axis=0u;axis<3u;axis++){
  let span=toF32(dSub(wideDouble(frame.high[axis]),wideDouble(frame.low[axis])));
  if(!isFiniteWord(span)||(span>>31u)!=0u||span==0u){continue;}
  low[axis]=wideByte(child.low[axis],frame.low[axis],fromF32(span),false);
  high[axis]=wideByte(child.high[axis],frame.low[axis],fromF32(span),true);
 }
 return vec3u(low.x|(low.y<<8u)|(low.z<<16u)|(high.x<<24u),high.y|(high.z<<8u)|(count<<16u)|(1u<<24u),offset);
}`,
)
