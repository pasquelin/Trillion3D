import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** A cluster's header as the decode reads it from a `WGP3` page (`docs/FORMAT.md`): each stream's
 *  count, field widths, quantization step and minimum, and the word its stream starts at. */
export const CLUSTER_HEADER_WGSL = wgslBlock(
  'CLUSTER_HEADER_WGSL',
  [],
  `struct ClusterHeader{
 vertexCount:u32,indexCount:u32,flags:u32,indexBits:u32,prefixBits:u32,recordBits:u32,
 positionCount:u32,linkBits:u32,
 posBits:vec3u,posStep:f32,posMin:vec3f,
 uvBits:vec2u,uvStep:f32,uvMin:vec2f,uv1Bits:vec2u,uv1Step:f32,uv1Min:vec2f,
 colorBits:vec4u,colorStep:f32,colorMin:vec4f,
 quantizationError:f32,
 // Word offset of each stream from the page's first word: block table, corners, x, y, z, links, normal, u, v, u1, v1, r, g, b, a.
 blocks:u32,corners:u32,pos:vec3u,links:u32,normal:u32,uv:vec2u,uv1:vec2u,color:vec4u,
 // The skin (\`deform.rs\`): its joints' base and width, and its first stream; the morph targets'
 // count and the word their streams are counted from, each target's record after the header.
 skinBase:u32,skinBits:u32,skin:u32,influences:u32,morphCount:u32,streams:u32,
}`,
)
