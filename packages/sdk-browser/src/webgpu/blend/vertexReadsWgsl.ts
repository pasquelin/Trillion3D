import { BLEND_BINDINGS } from '../core/bindLayout.ts'
import { BLEND_ITEM_WGSL } from './items.ts'
import { BLEND_VIEW_WGSL } from './viewLayout.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from '../../visibility/shader/pageWgsl.ts'
import { PAGE_NORMAL_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts'
import { LINE_CLIP_WGSL } from '../../visibility/shader/lineWgsl.ts'
import { SPRITE_WGSL } from '../../visibility/shader/spriteWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** What every vertex stage of the runs binds and reads before its layout's own reads. */
export const VERTEX_READS_WGSL = wgslBlock(
  'VERTEX_READS_WGSL',
  [
    BLEND_VIEW_WGSL,
    BLEND_ITEM_WGSL,
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

/** The stage's output, its UV and ids lanes those of the layout (`LAYOUTS`,
 *  `vertexWgsl.ts`). */
export const vsOutWgsl = (uv: string, ids: string) =>
  wgslBlock(
    `vsOutWgsl(${uv}, ${ids})`,
    [],
    `// What the vertex stage reads on the item record and the fragment stage re-reads as-is: the six
// maps, their factors and the flags, constant over the call, therefore FLAT (no per-call binding).
// \`water\` is the item's one-based transmissive rank, carried above its flags, zero for a blend;
// above it, the cull mode a doubtful triangle leaves to the fragment stage (facing.ts).
// \`alphaAo\` carries, after the alpha test and the occlusion strength, a dashed line's dash and gap.
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) uv:${uv},@location(2) view:vec3f,@location(3) normal:vec4f,@location(4) tangent:vec4f,@location(5) bitangent:vec4f,@location(6) @interpolate(flat) tri:u32,@location(7) bary:vec3f,@location(8) @interpolate(flat) diagId:u32,@location(9) @interpolate(flat) ids:${ids},@location(10) @interpolate(flat) maps:vec4u,@location(11) @interpolate(flat) alphaAo:vec4f,@location(12) @interpolate(flat) pbr:vec4f,@location(13) @interpolate(flat) emissive:vec4f,@location(14) @interpolate(flat) water:u32,}`,
  )
