import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** A cluster's header as the decode reads it from a `WGP3` page (`docs/FORMAT.md`): each stream's
 *  count, field widths, grid and range, and the word its stream starts at. It holds no array: a
 *  texture set's widths, least codes and offsets are read where the set is (`clusterUvSet`), as a
 *  page's own words give them, so a shader holds a header in registers. */
export const CLUSTER_HEADER_WGSL = wgslBlock(
  'CLUSTER_HEADER_WGSL',
  [],
  `struct ClusterHeader{
 vertexCount:u32,indexCount:u32,flags:u32,indexBits:u32,prefixBits:u32,recordBits:u32,
 positionCount:u32,linkBits:u32,
 posBits:vec3u,posUnit:f32,posStart:vec3i,
 colorBits:vec4u,colorMin:vec4u,
 normalBits:u32,tangentBits:u32,
 // Word offset of each stream from the page's first word: block table, corners, x, y, z, links,
 // normal x and y, r, g, b, a, tangent; a texture set's two streams are read by clusterUvSet.
 blocks:u32,corners:u32,pos:vec3u,links:u32,normal:vec2u,color:vec4u,tangent:u32,
 // The skin (\`deform.rs\`): its joints' base and width, and its first stream; the morph targets'
 // count and the word their streams are counted from, each target's record after the header.
 skinBase:u32,skinBits:u32,skin:u32,influences:u32,morphCount:u32,streams:u32,table:u32,
}
// One texture set as its page stores it: the widths of its u and v fields, their least codes, and the word each stream starts at. Zero for a set the page does not carry.
struct ClusterUvSet{bitsX:u32,bitsY:u32,minX:u32,minY:u32,offX:u32,offY:u32,}`,
)
