import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'

/** A cluster's header as the decode reads it from a `WGP3` page (`docs/FORMAT.md`): each stream's
 *  count, field widths, grid and range, and the word its stream starts at. A texture set's fields
 *  are one element of an array of `MAX_UV_SETS`, the set's rank the index: `uvBitsX` the widths of
 *  the sets' `u` fields, `uvMinY` the least code of their `v` fields. */
export const CLUSTER_HEADER_WGSL = wgslBlock(
  'CLUSTER_HEADER_WGSL',
  [],
  `struct ClusterHeader{
 vertexCount:u32,indexCount:u32,flags:u32,indexBits:u32,prefixBits:u32,recordBits:u32,
 positionCount:u32,linkBits:u32,
 posBits:vec3u,posUnit:f32,posStart:vec3i,
 uvBitsX:array<u32,${MAX_UV_SETS}>,uvBitsY:array<u32,${MAX_UV_SETS}>,uvMinX:array<u32,${MAX_UV_SETS}>,uvMinY:array<u32,${MAX_UV_SETS}>,
 colorBits:vec4u,colorMin:vec4u,
 normalBits:u32,tangentBits:u32,
 // Word offset of each stream from the page's first word: block table, corners, x, y, z, links, normal x and y, the sets' u then their v, r, g, b, a, tangent.
 blocks:u32,corners:u32,pos:vec3u,links:u32,normal:vec2u,uvX:array<u32,${MAX_UV_SETS}>,uvY:array<u32,${MAX_UV_SETS}>,color:vec4u,tangent:u32,
 // The skin (\`deform.rs\`): its joints' base and width, and its first stream; the morph targets'
 // count and the word their streams are counted from, each target's record after the header.
 skinBase:u32,skinBits:u32,skin:u32,influences:u32,morphCount:u32,streams:u32,table:u32,
}`,
)
