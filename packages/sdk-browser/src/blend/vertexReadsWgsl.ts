import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { BLEND_ITEM_WGSL } from './items.ts'
import { BLEND_VIEW_WGSL } from './viewLayout.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from '../visibility/shader/pageWgsl.ts'
import { PAGE_NORMAL_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { LINE_CLIP_WGSL } from '../visibility/shader/lineWgsl.ts'
import { SPRITE_WGSL } from '../visibility/shader/spriteWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { materialTableWgsl } from '../materials/table/materialWgsl.ts'
import { HISTORY_GIVEN_UP_WGSL } from '../visibility/types.ts'
import { clippedStructText } from '../gpu/core/clipDistances.ts'

/** What every vertex stage of the runs binds and reads before its layout's own reads: the item
 *  records, and the material table their surfaces' records lie in. */
export const VERTEX_READS_WGSL = wgslBlock(
  'VERTEX_READS_WGSL',
  [
    BLEND_VIEW_WGSL,
    BLEND_ITEM_WGSL,
    materialTableWgsl(BLEND_BINDINGS.material),
    normalAtlasWgsl(BLEND_BINDINGS.normals),
    PAGE_INFO_STRUCT_WGSL,
    PAGE_NORMAL_WGSL,
  ],
  `@group(0) @binding(${BLEND_BINDINGS.indices}) var<storage, read> indices:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.positions}) var<storage, read> positions:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.uvs}) var<storage, read> uvs:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.uniform}) var<uniform> uni:BlendView;
@group(0) @binding(${BLEND_BINDINGS.items}) var<storage,read> items:array<BlendItem>;
`,
)

/** The instances, cluster spans and diagnostics the stage reads, and its line and sprite rules. */
export const VERTEX_LISTS_WGSL = wgslBlock(
  'VERTEX_LISTS_WGSL',
  [LINE_CLIP_WGSL, SPRITE_WGSL],
  `@group(0) @binding(${BLEND_BINDINGS.clusterDiagnostic}) var<storage,read> clusterDiagnostic:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.planInstances}) var<storage,read> planInstances:array<vec2u>;
@group(0) @binding(${BLEND_BINDINGS.clusterSpans}) var<storage,read> clusterSpans:array<vec4u>;
`,
)

/** Where `tri` carries, above the triangle's rank in its cluster (`VIS_TRIANGLE_BITS`), a lobed
 *  program's UV channels word (`channelsOf`): read from the record by the vertex stage, which reads
 *  it already, and handed to the fragments (`blendGrads`, `shaderSurface.ts`), which read no record
 *  for it. */
export const TRI_CHANNELS_SHIFT = 16
/** Where `tri` carries, above the channels (`SURFACE_MAP_FIELDS`, seven bits), the item's history
 *  share code (`ITEM_HISTORY_SHIFT`): read off the item by the vertex stage, which reads it already. */
export const TRI_GIVEN_UP_SHIFT = 28

/** What a transparent fragment's surface gives up of the temporal history, from its code in `tri`
 *  (`TRI_GIVEN_UP_SHIFT`): its layer writes it at its coverage (`GIVEN_UP_TARGET`). */
export const BLEND_GIVEN_UP_WGSL = wgslBlock(
  'BLEND_GIVEN_UP_WGSL',
  [HISTORY_GIVEN_UP_WGSL],
  `fn blendGivenUp(in:VSOut,coverage:f32)->f32{return historyGivenUp(in.tri>>${TRI_GIVEN_UP_SHIFT}u)*coverage;}`,
)

/** The members of the stage's output, its UV and ids lanes those of the layout. */
const vsOutMembers = (uv: string, ids: string) => [
  '@builtin(position) position:vec4f',
  '@location(0) color:vec4f',
  `@location(1) uv:${uv}`,
  '@location(2) view:vec3f',
  '@location(3) normal:vec4f',
  '@location(4) tangent:vec4f',
  '@location(5) bitangent:vec4f',
  '@location(6) @interpolate(flat) tri:u32',
  '@location(7) bary:vec3f',
  '@location(8) @interpolate(flat) diagId:u32',
  `@location(9) @interpolate(flat) ids:${ids}`,
  '@location(10) @interpolate(flat) maps:vec4u',
  '@location(11) @interpolate(flat) alphaAo:vec4f',
  '@location(12) @interpolate(flat) pbr:vec4f',
  '@location(13) @interpolate(flat) emissive:vec4f',
  '@location(14) @interpolate(flat) material:u32',
]

/** The stage's output, its UV and ids lanes those of the layout (`LAYOUTS`,
 *  `vertexWgsl.ts`); `clip`, the device has `clip-distances`: the vertex stage returns the struct
 *  that carries the distance to the view's plane beside it (`clippedStructText`), a device without
 *  it testing the distance of each pixel from `view`, the world position — fifteen interpolants
 *  and the front face fill the sixteen a stage is granted, no one more fits. */
export const vsOutWgsl = (uv: string, ids: string, clip = false) =>
  wgslBlock(
    `vsOutWgsl(${uv}, ${ids}${clip ? ', clip' : ''})`,
    [],
    `// What the vertex stage reads on the item's surface's record and the fragment stage re-reads
// as-is: the six maps, their factors and the flags, constant over the call, therefore FLAT.
// \`material\` is the rank of the item's surface record, which a transmissive fragment reads its
// volume from (\`materialAt\`); above it, the cull mode a doubtful triangle leaves to the fragment
// stage (facing.ts).
// \`alphaAo\` carries, after the alpha test and the occlusion strength, a dashed line's dash and gap.
struct VSOut{${vsOutMembers(uv, ids).join(',')},}${clip ? `\n${clippedStructText('VSOut', vsOutMembers(uv, ids))}` : ''}`,
  )
