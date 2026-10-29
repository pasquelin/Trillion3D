import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { HAIR_FLAG } from './materialMath.ts'
import { hairTileQuadVs } from './tilesWgsl.ts'
import {
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
} from './visibilityMath.ts'

/** The bindings of the custom depth's group 0 (binding 0 is the image block, `HAIR_IMAGE_WGSL`). */
const HAIR_CUSTOM_DEPTH_BINDINGS = {
  tiles: 1,
  nodeIndex: 2,
  nodeData: 3,
  coverage: 4,
  rule: 5,
} as const

const B = HAIR_CUSTOM_DEPTH_BINDINGS

/**
 * THE STRANDS' CUSTOM DEPTH, drawn over the tiles with strands: where the strands cover a pixel to `rule.coverage` and the first
 * of its samples is of a strand that renders custom depth (`HAIR_FLAG.renderCustomDepth`), the depth of that sample is written
 * into the custom depth, every other pixel is discarded. A depth of 0, reverse-Z, is no strand.
 */
export const HAIR_CUSTOM_DEPTH_WGSL = wgslProgram(
  `struct HairCustomDepthRule{coverage:f32,pad0:f32,pad1:f32,pad2:f32}
@group(0) @binding(${B.tiles}) var<storage,read> tiles:array<u32>;
@group(0) @binding(${B.nodeIndex}) var nodeIndex:texture_2d<u32>;
@group(0) @binding(${B.nodeData}) var<storage,read> nodeData:array<u32>;
@group(0) @binding(${B.coverage}) var coverage:texture_2d<f32>;
@group(0) @binding(${B.rule}) var<uniform> rule:HairCustomDepthRule;
@fragment fn hairCustomDepthFs(@builtin(position) position:vec4f)->@builtin(frag_depth) f32{
 let pixel=vec2i(position.xy);
 let desc=textureLoad(nodeIndex,pixel,0).x;
 if((desc>>${HAIR_NODE_OFFSET_BITS}u)==0u||textureLoad(coverage,pixel,0).r<rule.coverage){discard;}
 let at=(desc&${HAIR_NODE_OFFSET_MASK}u)*${HAIR_NODE_DATA_WORDS}u;
 if((((nodeData[at+4u]>>16u)&0xffu)&${HAIR_FLAG.renderCustomDepth}u)==0u){discard;}
 return bitcast<f32>(nodeData[at]);
}`,
  [hairTileQuadVs],
)
