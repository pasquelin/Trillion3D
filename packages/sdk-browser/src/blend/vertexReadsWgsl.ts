import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { BLEND_ITEM_WGSL } from './items.ts'
import { BLEND_VIEW_WGSL } from './viewLayout.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from '../visibility/shader/pageWgsl.ts'
import { PAGE_NORMAL_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { LINE_CLIP_WGSL } from '../visibility/shader/lineWgsl.ts'
import { SPRITE_WGSL } from '../visibility/shader/spriteWgsl.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { LIGHTING_CHANNEL_COUNT } from '../../../sdk-core/src/contracts/lightingChannelsAbi.ts'
import { LIGHTING_CHANNELS_WGSL } from '../lighting/lightingChannelsWgsl.ts'
import { materialTableWgsl } from '../materials/table/materialWgsl.ts'
import { RESPONSIVE_BITS, RESPONSIVE_MARK_WGSL } from '../visibility/types.ts'
import { clippedStructText, type Clipping } from '../gpu/core/clipDistances.ts'
import { SURFACE_MAP_FIELDS } from '../visibility/materialType.ts'
import { MATERIAL_FLAG } from '../materials/table/materialLayout.ts'

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

/** The instances, cluster spans and identities the stage reads, and its line and sprite rules. The buffer of
 *  the spans holds the identity words after them, four to an element, the entries being four fifths of its
 *  length (`compactBuffers`): the diagnostic views' cluster word of an entry is `clusterIdentity`. */
export const VERTEX_LISTS_WGSL = wgslBlock(
  'VERTEX_LISTS_WGSL',
  [LINE_CLIP_WGSL, SPRITE_WGSL],
  `@group(0) @binding(${BLEND_BINDINGS.planInstances}) var<storage,read> planInstances:array<vec2u>;
@group(0) @binding(${BLEND_BINDINGS.clusterSpans}) var<storage,read> clusterSpans:array<vec4u>;
fn clusterIdentity(entry:u32)->u32{return clusterSpans[arrayLength(&clusterSpans)*4u/5u+(entry>>2u)][entry&3u];}
`,
)

/** The three words of the item the stage hands over flat in one member of its output (`VSOut.words`),
 *  as the vertex stage writes them and a fragment reads them (`in.` and `out.` before): `tri` the
 *  triangle's rank in its cluster with the channels word and the responsiveness code above it, `diagId`
 *  the diagnostic views' cluster word (in any other view, the bits of the item's opacity clip), `material` the rank of the item's surface record with the
 *  cull mode a doubtful triangle leaves to the fragment stage above it (`facing.ts`). */
export const WORDS = { tri: 'words.x', diagId: 'words.y', material: 'words.z' } as const

/** Where `tri` carries, above the triangle's rank in its cluster (`VIS_TRIANGLE_BITS`), a lobed
 *  program's UV channels word (`channelsOf`): read from the record by the vertex stage, which reads
 *  it already, and handed to the fragments (`blendGrads`, `shaderSurface.ts`), which read no record
 *  for it. */
export const TRI_CHANNELS_SHIFT = 16
/** The bits of the channels word `tri` carries, a bit a map (`SURFACE_MAP_FIELDS`). */
export const TRI_CHANNELS_BITS = SURFACE_MAP_FIELDS.length
/** Where `tri` carries, above the channels, the item's lighting channels
 *  (`ITEM_CHANNELS_SHIFT`), stored: read off the item by the vertex stage, which reads it already, for the
 *  fragment to light the surface only with the lights that share a channel with it (`blendChannelsOf`). */
export const TRI_LIGHTING_CHANNELS_SHIFT = TRI_CHANNELS_SHIFT + TRI_CHANNELS_BITS
/** Where `tri` carries, above the lighting channels, the item's
 *  responsiveness code (`ITEM_RESPONSIVE_SHIFT`): read off the item by the vertex stage, which reads
 *  it already. */
export const TRI_RESPONSIVE_SHIFT = TRI_LIGHTING_CHANNELS_SHIFT + LIGHTING_CHANNEL_COUNT
/** Where `tri` carries, above the responsiveness code, whether the item's object is held out (`ITEM_HOLDOUT`). The next fact
 *  of a see-through item is read in the fragment from the material table bound there (`materialAt`, a flag of
 *  `MATERIAL_FLAG` for a fact of its material, `materialFlagOf`), not from another interpolant. */
export const TRI_HOLDOUT_SHIFT = TRI_RESPONSIVE_SHIFT + RESPONSIVE_BITS
/** Where `tri` carries, above the holdout, the facts of the item's material the fragment reads (`MATERIAL_FLAG`), in the order of their
 *  bits: the vertex stage writes them from the record it reads already (`TRI_MATERIAL_FLAGS`), so that the fragment reads no
 *  material texel for them. */
export const TRI_MATERIAL_SHIFT = TRI_HOLDOUT_SHIFT + 1
/** The bits of `MATERIAL_FLAG`, all of them. */
export const TRI_MATERIAL_FLAGS = Object.values(MATERIAL_FLAG).reduce((all, bit) => all | bit, 0)
/** Whether the material flag `flag` of `MATERIAL_FLAG` is set for the surface the fragment `in` belongs to, as a WGSL expression:
 *  read from its triangle word, where the vertex stage put it (`TRI_MATERIAL_SHIFT`). */
export const materialFlagOf = (flag: keyof typeof MATERIAL_FLAG) =>
  `(((in.${WORDS.tri}>>${TRI_MATERIAL_SHIFT}u)&${MATERIAL_FLAG[flag]}u)!=0u)`

/** The mask of the lighting channels of the item the fragment `in` belongs to, from its triangle word. */
export const BLEND_CHANNELS_WGSL = wgslFn(
  'blendChannelsOf',
  [LIGHTING_CHANNELS_WGSL],
  `fn blendChannelsOf(in:VSOut)->u32{return storedToChannels(in.${WORDS.tri}>>${TRI_LIGHTING_CHANNELS_SHIFT}u);}`,
)

/** What a transparent fragment's layer writes of its surface's responsiveness, from its code in
 *  `tri` (`TRI_RESPONSIVE_SHIFT`): its mark (`RESPONSIVE_MARK_WGSL`) where its `opacity` is above 0
 *  and under the clip value of its surface's opacity mask plus a 255th — the pixels it hides next to
 *  nothing —, none elsewhere (`RESPONSIVE_TARGET`). The clip value is the item's (`ITEM.opacityClip`),
 *  which the vertex stage hands over in the word the diagnostic views' cluster word takes (`WORDS`).
 *  The layer's depth test against the opaque scene is the pass's. */
export const BLEND_RESPONSIVE_WGSL = wgslBlock(
  'BLEND_RESPONSIVE_WGSL',
  [RESPONSIVE_MARK_WGSL],
  `fn blendResponsive(in:VSOut,opacity:f32)->f32{
 return select(0.0,responsiveMark(in.${WORDS.tri}>>${TRI_RESPONSIVE_SHIFT}u),opacity>0.0&&opacity<1.0/255.0+bitcast<f32>(in.${WORDS.diagId}));
}`,
)

/** The members of the stage's output, its UV and ids lanes those of the layout, then the program's
 *  extras (`vertexExtras.ts`), one location each past the thirteen every program has. */
const vsOutMembers = (uv: string, ids: string, extras: readonly string[]) => [
  '@builtin(position) position:vec4f',
  '@location(0) color:vec4f',
  `@location(1) uv:${uv}`,
  '@location(2) view:vec3f',
  '@location(3) normal:vec4f',
  '@location(4) tangent:vec4f',
  '@location(5) bitangent:vec4f',
  '@location(6) bary:vec3f',
  '@location(7) @interpolate(flat) words:vec3u',
  `@location(8) @interpolate(flat) ids:${ids}`,
  '@location(9) @interpolate(flat) maps:vec4u',
  '@location(10) @interpolate(flat) alphaAo:vec4f',
  '@location(11) @interpolate(flat) pbr:vec4f',
  '@location(12) @interpolate(flat) emissive:vec4f',
  ...extras.map((name, i) => `@location(${13 + i}) ${name}:vec4f`),
]

/** The stage's output, its UV and ids lanes those of the layout (`LAYOUTS`,
 *  `vertexWgsl.ts`); cutting at the view's plane by distance (`clipping`), the vertex stage returns
 *  the struct that carries the distance beside it (`clippedStructText`); by pixel, each fragment
 *  tests the distance from `view`, the world position. Thirteen interpolants, and the two extras at
 *  most (`extras`, `vertexExtras.ts`): with the front face, the sixteen a stage is granted. */
export const vsOutWgsl = (
  uv: string,
  ids: string,
  clipping?: Clipping,
  extras: readonly string[] = [],
) =>
  wgslBlock(
    `vsOutWgsl(${uv}, ${ids}${clipping === 'distance' ? ', distance' : ''}${extras.length ? `, ${extras.join('+')}` : ''})`,
    [],
    `// What the vertex stage reads on the item's surface's record and the fragment stage re-reads
// as-is: the six maps, their factors and the flags, constant over the call, therefore FLAT.
// \`words\` holds three of them (\`WORDS\`): the triangle's rank, the diagnostic word and the rank of
// the item's surface record, which a transmissive fragment reads its volume from (\`materialAt\`);
// above that rank, the cull mode a doubtful triangle leaves to the fragment stage (facing.ts).
// \`alphaAo\` carries, after the alpha test and the occlusion strength, a dashed line's dash and gap.
struct VSOut{${vsOutMembers(uv, ids, extras).join(',')},}${clipping === 'distance' ? `\n${clippedStructText('VSOut', vsOutMembers(uv, ids, extras))}` : ''}`,
  )
