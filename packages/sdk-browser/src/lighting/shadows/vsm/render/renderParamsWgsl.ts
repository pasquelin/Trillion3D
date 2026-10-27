import { wgslConsts } from '../../../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { ceilDivWgsl } from '../../../../../../math/src/wgsl/integer.ts'
import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import { VSM_OVERFLOW_WGSL } from '../overflowWgsl.ts'
import { GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'

/** THE SHADOW RASTER'S PARAMETERS AND INDIRECT ARGUMENTS (`renderCullWgsl.ts`): its view pass's
 *  uniform, its counters and the one-thread kernels that arm each next stage. */

/** The raster's corner tiers: tier t of a family draws `VSM_RENDER_TIER_CORNERS << t` corners a
 *  record, a row taking the least tier that holds its corners (`vsmRenderTierOf`) — at most 256
 *  triangles a row, 768 corners, the last tier's. The hardware raster's tiers come in three
 *  families of `VSM_RENDER_CORNER_TIERS` (`VSM_RENDER_FAMILY`): the one-sided rows', whose pipelines
 *  cull the back faces; the two-sided rows' (`FLAG_DOUBLE`), no face culled, a row drawn once, its
 *  corners its index count (`VSM_RENDER_DOUBLE_BIT`); and the voxel rows' (`FLAG_VOXEL`), their
 *  records drawn by the voxel raster (`renderVoxelWgsl.ts`) — a page's bricks' boxes, one-sided, 36
 *  corners a brick, 756 for its 21 at most: no record launches more than twice the corners its page
 *  draws, nor fewer than 96 (`VSM_RENDER_VOXEL_BIT`). The two-sided tiers' pipelines are compiled with the
 *  one-sided ones, the voxel tiers' only where the session holds voxel bricks; the tiers of those
 *  two families are drawn only on a frame whose table holds a row of the family
 *  (`vsmRenderTiersDrawn`). A candidate says its family by the bit of it in its corners, above any
 *  count a row draws; a voxel row's wins. */
export const VSM_RENDER_CORNER_TIERS = 4
const VSM_RENDER_TIER_CORNERS = 96
const VSM_RENDER_DOUBLE_BIT = 0x4000
const VSM_RENDER_VOXEL_BIT = 0x8000
export const VSM_RENDER_FAMILY = { oneSided: 0, twoSided: 1, voxel: 2 } as const
const VSM_RENDER_TIERS = Object.keys(VSM_RENDER_FAMILY).length * VSM_RENDER_CORNER_TIERS
/** The software raster's bins (`renderSoftwareWgsl.ts`), after the hardware tiers: the records of
 *  the clusters small enough in their map's mip view (`vsmRenderSoftware`), each a window of one
 *  page, rastered in compute, the dynamic layer's in the first bin and the static layer's in the
 *  second (the second dispatch launches a group for the static layer's alone). Their records lie
 *  first in the sorted list, their counts in the list's word past the capacity (`vsmRenderBin`). */
export const VSM_RENDER_SOFTWARE_BIN = VSM_RENDER_TIERS
const VSM_RENDER_SOFTWARE_STATIC_BIN = VSM_RENDER_SOFTWARE_BIN + 1
/** The bins: the hardware tiers and the software raster's two. */
const VSM_RENDER_BINS = VSM_RENDER_SOFTWARE_STATIC_BIN + 1
/** The corners a record of tier `tier` draws. */
export const vsmRenderTierCorners = (tier: number) =>
  VSM_RENDER_TIER_CORNERS << (tier % VSM_RENDER_CORNER_TIERS)
/** The family of a hardware tier (`VSM_RENDER_FAMILY`). */
export const vsmRenderTierFamily = (tier: number) => Math.floor(tier / VSM_RENDER_CORNER_TIERS)
/** The raster's families a frame draws: the two-sided rows' where the session holds a two-sided
 *  surface (`FLAG_DOUBLE` on its rows), the voxel rows' where it holds voxel bricks. */
export interface CompiledTiers {
  twoSided: boolean
  voxels: boolean
}
/** The bits of a frame's key into `TIERS_DRAWN`: the table holds a two-sided row, a voxel row. */
const DRAWN_TWO_SIDED = 1
const DRAWN_VOXEL = 2
const drawnKey = (twoSided: boolean, voxels: boolean) =>
  (twoSided ? DRAWN_TWO_SIDED : 0) | (voxels ? DRAWN_VOXEL : 0)
const TIERS_DRAWN = Array.from({ length: drawnKey(true, true) + 1 }, (_, held) =>
  [
    VSM_RENDER_FAMILY.oneSided,
    ...(held & DRAWN_TWO_SIDED ? [VSM_RENDER_FAMILY.twoSided] : []),
    ...(held & DRAWN_VOXEL ? [VSM_RENDER_FAMILY.voxel] : []),
  ].flatMap((family) =>
    Array.from({ length: VSM_RENDER_CORNER_TIERS }, (_, t) => family * VSM_RENDER_CORNER_TIERS + t),
  ),
)
/** The hardware tiers a frame draws: the one-sided rows', and those of the two-sided and the voxel
 *  rows while the table holds a row of each. */
export const vsmRenderTiersDrawn = ({ twoSided, voxels }: CompiledTiers) =>
  TIERS_DRAWN[drawnKey(twoSided, voxels)]!
/** The pages a side of the window a record draws spans: the reference's raster window
 *  (`VSM_RENDER_WINDOW_PAGES`), the cull emitting a record a window of a caster's page rect and the
 *  raster drawing it over a viewport of that many pages (`renderRasterWgsl.ts`). */
export const VSM_RENDER_WINDOW_PAGES = 4
/** Words of a view pass's indirect arguments: the cull's 3; the bin's 3, a thread a record
 *  (`vsmRenderBin`); then a draw of 4 a tier; then the software raster's 3 a layer, a group a record
 *  of the layer (the dynamic layer's, then the static layer's). */
export const VSM_RENDER_ARGS_CULL = 0
export const VSM_RENDER_ARGS_BIN = 3
export const VSM_RENDER_ARGS_DRAW = 6
export const VSM_RENDER_ARGS_SOFTWARE = VSM_RENDER_ARGS_DRAW + 4 * VSM_RENDER_TIERS
export const VSM_RENDER_ARGS_SOFTWARE_STATIC = VSM_RENDER_ARGS_SOFTWARE + 3
/** And the post cull's: a thread a caster the descent's post pass found, a listed light a z. */
export const VSM_RENDER_ARGS_POST = VSM_RENDER_ARGS_SOFTWARE_STATIC + 3
export const VSM_RENDER_ARGS_WORDS = VSM_RENDER_ARGS_POST + 3
/** Counter words: [0] the candidates; [1] the pages the shadow views' descent listed within its
 *  room, which the casters' kernel runs over, [2] the first of them the running pass of the descent
 *  listed (none in the main pass), [3] the casters found before the descent's post pass; then the
 *  view pass's own, cleared before each pass from `VSM_RENDER_COUNT_PASS`: [4] the lights the GPU
 *  listed — those with a page to draw —, [5] the maps listed in their runs (`renderViewsWgsl.ts`),
 *  [6] the records the cull stored to be drawn, [7] the places it asked of the list — the records
 *  to draw and those it holds back, past the capacity too —, [8] the records the occlusion's first
 *  cull held back, stored from the list's end (`vsmRenderHold`), and each bin's records and cursor
 *  (`VSM_RENDER_TIER_RECORDS`, `_CURSOR` + bin). */
const VSM_RENDER_COUNT_LISTED = 1
const VSM_RENDER_COUNT_LISTED_FIRST = 2
/** The casters found before the descent's post pass: where the post cull's candidates start. */
const VSM_RENDER_COUNT_CAST_FIRST = 3
export const VSM_RENDER_COUNT_PASS = 4
const VSM_RENDER_COUNT_VIEWS = 4
const VSM_RENDER_COUNT_RUNS = 5
const VSM_RENDER_COUNT_RECORDS = 6
const VSM_RENDER_COUNT_TAKEN = 7
const VSM_RENDER_COUNT_HELD = 8
const VSM_RENDER_TIER_RECORDS = 9
const VSM_RENDER_TIER_CURSOR = VSM_RENDER_TIER_RECORDS + VSM_RENDER_BINS
export const VSM_RENDER_COUNT_WORDS = VSM_RENDER_TIER_CURSOR + VSM_RENDER_BINS
/** Map view flag: directional (clipmap level, 1 mip, no near clip). */
const VSM_RENDER_VIEW_DIRECTIONAL = 1
/** The cull's four kinds: with no occlusion test, the occlusion's first cull against the previous
 *  frame's pyramid, its second against this frame's over the records the first held back, and its
 *  post cull, over the casters the descent's post pass found, against this frame's too. */
const VSM_RENDER_CULL_ALL = 0
const VSM_RENDER_CULL_FIRST = 1
const VSM_RENDER_CULL_SECOND = 2
const VSM_RENDER_CULL_POST = 3
/** The bits of `VsmRenderParams.tessellated`: the kinds of light whose maps take a displaced
 *  surface tessellated — the suns', the local lights'. */
export const VSM_RENDER_TESSELLATE_DIRECTIONAL = 1
export const VSM_RENDER_TESSELLATE_LOCAL = 2

/**
 * A view pass's parameters (one slot each, the device's `uniformStride` apart, the same frame values
 * in every slot), in one table: the struct the kernels read and the words the host writes
 * (`vsmWriteRenderParams`, `renderParams.ts`). The main view gives the casters what a shadow takes of
 * the view: its eye (split double) and the third row of its world-to-view rotation (engine
 * convention, −Z forward), for a sun's far-shadow test, the draw distances and the size of an
 * object on it;
 * `threshold` is the error in a map's pixels a cluster drawn in it may show, the cut's threshold
 * scaled by the shadows' level-of-detail bias (`shadowGeometryLodBias`); `worldLinks`, the cold word
 * its cut's world links start at, zero for a cut that follows no world, whose switch the casters obey
 * (`VsmRenderScene.world`); `farMeshes`, 1 when a sun's far-shadow test reaches every caster, 0 when
 * it reaches the world's merged shells alone (`farShadowCullsAllMeshes`, `vsmFarShadowSkipped`);
 * `drawDistances`, the draw distances the casters take, from the main view's eye and scaled by
 * `viewDistanceScale` (`vsmRenderOutsideDrawDistance`): bit 0 those of the objects of their own,
 * bit 1 those of the instances of an instanced mesh, 0 when none does; `farDrop`, the greatest
 * far-shadow distance of the frame's lights when every one is a sun that has one, else 0: the
 * candidates leave out a caster that no map view takes (`vsmFarShadowSkipped`); `filterBase`, the
 * word of the bits the main view's filter holds (`vsmRenderFilteredOut`) its candidates read in their
 * group 1, zero for a view that filters none. A slot belongs to one view pass
 * (`renderViewPasses.ts`): `viewFirst` and `viewCount` are the ids of its maps; `lightCount`, the
 * lights of the frame (`vsmRenderViews`: its table, and where the views' runs begin in its list);
 * `recordCapacity`, the records its list holds; `tessellated`, the kinds of light whose maps take a
 * displaced surface's tessellated shape (`VSM_RENDER_TESSELLATE_*`), zero for none;
 *
 * `hardwareEdge`, the edge in a map's pixels past which a cluster is the hardware raster's
 * (`hardwareRasterEdgePixels`, the camera's rule), zero where the software raster is off
 * (`softwareRaster`): every cluster is then the hardware raster's; `viewCap`, the views the shadow
 * views' descent lists at most, a view a map and a mip of it (`../traversal/`).
 *
 * The candidates read the rest: `listedBase`, the word of the shadow views' descent's flags its
 * listed pages start at (`../traversal/`), which they run a thread each over; `casterCap`, the
 * candidates the lists hold room for; `pageCount`, the cut's pages (its residency bits); `eye0` and `eye1`, the main view's eye
 * as three doubles' words (`translationAtEye`'s), the eye the cut's worlds are brought to.
 */
export const VSM_RENDER_PARAMS = fieldLayout('VsmRenderParams', [
  ['eyeHigh', 'vec3f'],
  ['threshold', 'f32'],
  ['eyeLow', 'vec3f'],
  ['viewRow2', 'vec4f'],
  ['viewCount', 'u32'],
  ['viewFirst', 'u32'],
  ['lightCount', 'u32'],
  ['recordCapacity', 'u32'],
  ['worldLinks', 'u32'],
  ['farMeshes', 'u32'],
  ['drawDistances', 'u32'],
  ['viewDistanceScale', 'f32'],
  ['farDrop', 'f32'],
  ['filterBase', 'u32'],
  ['tessellated', 'u32'],
  ['casterCap', 'u32'],
  ['listedBase', 'u32'],
  ['pageCount', 'u32'],
  ['eye0', 'vec4u'],
  ['eye1', 'vec4u'],
  ['hardwareEdge', 'f32'],
  ['viewCap', 'u32'],
] as const)
const VSM_RENDER_PARAMS_STRUCT_WGSL = wgslBlock(
  'VSM_RENDER_PARAMS_STRUCT_WGSL',
  [],
  VSM_RENDER_PARAMS.wgsl,
)
export const VSM_RENDER_PARAMS_WGSL = wgslBlock(
  'VSM_RENDER_PARAMS_WGSL',
  [VSM_RENDER_PARAMS_STRUCT_WGSL],
  `
/** A caster: a resident cluster that may cast, whatever level of detail a map takes of it. Its world
 *  sphere (centre high + radius, centre low) and its world box about that centre (its three half
 *  axes, \`a0\` to \`a2\`: what the frustum cull tests; the sphere is what the light's range, the
 *  level of detail and the raster choice measure), its row, corners and flags (bit 0 cache as
 *  dynamic, bit 1 deforming: it invalidates the pages it draws), its far depth: the depth along the
 *  main view of the nearest point of the sphere of the whole object it belongs to, which a sun's
 *  far-shadow test reads (\`vsmFarShadowSkipped\`), and its longest edge in world units (\`edge\`, 0 for none known),
 *  which picks its raster. Then what each map judges its level of detail by (\`vsmRenderLodAt\`):
 *  its own bounds and its parent group's, each a centre from the world sphere's and a radius in
 *  world units, and both errors in world units, scaled as the camera's cut scales them (the
 *  placement's smallest axis scale) — the parent's negative for a root; the square of
 *  the distance past which its object stops evaluating its offset (\`offsetDisableSq\`, 0 for never,
 *  given to every cluster of a placement whose offset may invalidate its shadows).
 *  Last, how far its centre moved since the previous image (\`prevShift\`): the occlusion's first
 *  cull tests it where that image drew it; the placement's cache state per view (\`viewBits\`: bits
 *  0..15 cached as dynamic, 16..31 turned this frame), and the ball of the whole object the cluster
 *  belongs to, a centre from the world sphere's and a radius (\`inst\`): what a map judges whether
 *  the object stays out of the coarse pages by. Its half axes hold the reach of the placement's
 *  offset (\`casterSphere\`); \`axisFit\` is the factor each keeps where a map does not grow the bounds by
 *  it (\`vsmOffsetGrows\`), one for a placement with none. */
struct VsmRenderCandidate{c:vec4f,l:vec3f,row:u32,a0:vec3f,corners:u32,a1:vec3f,flags:u32,a2:vec3f,farDepth:f32,prevShift:vec3f,edge:f32,own:vec4f,parent:vec4f,inst:vec4f,errors:vec2f,offsetDisableSq:f32,viewBits:u32,axisFit:vec3f,}
const VSM_RENDER_CAND_DYNAMIC:u32=1u;
const VSM_RENDER_CAND_DEFORMING:u32=2u;
/** Bit 2: the row's triangles face the light clockwise in world space — a mirroring placement
 *  or a back-side row (\`FLAG_BACK\`), not both (\`vsmRenderCaster\`). */
const VSM_RENDER_CAND_FLIPPED:u32=4u;
/** Bit 3: a sun's far-shadow test reaches the row (\`vsmRenderFarFlags\`); bit 4: its object casts
 *  far shadows, which the test never leaves out. */
const VSM_RENDER_CAND_FAR_TESTED:u32=8u;
const VSM_RENDER_CAND_FAR_CAST:u32=16u;
/** Bit 5: the row is a displaced surface the frame tessellates (\`tessellatedFlags\`) while a kind of
 *  light's maps take it so (\`params.tessellated\`): its records are cut into patches and not drawn as
 *  its triangles, a masked one too: its cutout is judged at the patches' vertices or, where the
 *  vertex stage cannot bind the colour atlas, by the fragment (\`vsmTessellatedVertexWgsl\`). */
const VSM_RENDER_CAND_TESSELLATED:u32=32u;
/** Bit 6: the group finer than the cluster is resident (the cut rule's \`childResident\`). */
const VSM_RENDER_CAND_CHILD_RESIDENT:u32=64u;
/** Bit 7: its vertices move (a dynamic geometry, a deformation, an offset): its raster is judged at
 *  its whole sphere (\`c\`), not at its level of detail's (\`vsmRenderSoftware\`). */
const VSM_RENDER_CAND_MOVING:u32=128u;
/** Bit 8: the surface wears an offset its placement evaluates; bit 9: the surface evaluates it
 *  whatever the distance says; bit 10: the object keeps that offset from invalidating its shadows. */
const VSM_RENDER_CAND_OFFSET:u32=256u;
const VSM_RENDER_CAND_OFFSET_ALWAYS:u32=512u;
const VSM_RENDER_CAND_OFFSET_KEEPS:u32=1024u;
/** Bit 11: the object stands for a first-person one (\`MOBILITY_WORLD_SPACE\`): the suns' first-person
 *  clipmaps take it, the regular maps never. */
const VSM_RENDER_CAND_WORLD_SPACE:u32=2048u;
/** Bit 12: the placement wears an offset that may invalidate its shadows (\`MOBILITY_OFFSET_INVALIDATES\`),
 *  which puts every cluster of it in the dynamic layer of a map that allows the offset; bit 13: a surface
 *  of it evaluates the offset whatever the distance says (\`MOBILITY_OFFSET_ALWAYS\`). */
const VSM_RENDER_CAND_PLACEMENT_OFFSET:u32=4096u;
const VSM_RENDER_CAND_PLACEMENT_ALWAYS:u32=8192u;
/** The cut rule's verdicts on a candidate in a map's mip view (\`vsmRenderLodAt\`). */
const VSM_RENDER_LOD_NOT_DRAWN:u32=0u;
const VSM_RENDER_LOD_OWN:u32=1u;
const VSM_RENDER_LOD_BEHIND:u32=2u;
/** Whether a sun whose far-shadow distance is \`distance\` (a map's \`farShadowEdge\`, 0 for none)
 *  leaves the candidate out: its row is tested, does not cast far shadows, and its object's nearest
 *  point (\`farDepth\`) lies past \`distance\` along the main view. */
fn vsmFarShadowSkipped(flags:u32,farDepth:f32,distance:f32)->bool{
 return distance>0.0&&(flags&VSM_RENDER_CAND_FAR_TESTED)!=0u&&(flags&VSM_RENDER_CAND_FAR_CAST)==0u&&farDepth>distance;
}
${wgslConsts({
  VSM_RENDER_VIEW_DIRECTIONAL,
  VSM_RENDER_COUNT_LISTED,
  VSM_RENDER_COUNT_LISTED_FIRST,
  VSM_RENDER_COUNT_CAST_FIRST,
  VSM_RENDER_COUNT_VIEWS,
  VSM_RENDER_COUNT_RUNS,
  VSM_RENDER_COUNT_RECORDS,
  VSM_RENDER_COUNT_TAKEN,
  VSM_RENDER_COUNT_HELD,
  VSM_RENDER_TIER_RECORDS,
  VSM_RENDER_TIER_CURSOR,
  VSM_RENDER_TIERS,
  VSM_RENDER_BINS,
  VSM_RENDER_SOFTWARE_BIN,
  VSM_RENDER_SOFTWARE_STATIC_BIN,
  VSM_RENDER_TIER_CORNERS,
  VSM_RENDER_CORNER_TIERS,
  VSM_RENDER_DOUBLE_BIT,
  VSM_RENDER_VOXEL_BIT,
  VSM_RENDER_FAMILY_TWO_SIDED: VSM_RENDER_FAMILY.twoSided,
  VSM_RENDER_FAMILY_VOXEL: VSM_RENDER_FAMILY.voxel,
  VSM_RENDER_TESSELLATE_DIRECTIONAL,
  VSM_RENDER_TESSELLATE_LOCAL,
  VSM_RENDER_WINDOW_PAGES,
  VSM_RENDER_CULL_ALL,
  VSM_RENDER_CULL_FIRST,
  VSM_RENDER_CULL_SECOND,
  VSM_RENDER_CULL_POST,
})}
/** The least tier whose records draw \`corners\` corners: \`VSM_RENDER_TIER_CORNERS << level\` ≥ corners,
 *  in the family of the row: a voxel row's (\`VSM_RENDER_VOXEL_BIT\`) the voxel one, else a two-sided
 *  row's (\`VSM_RENDER_DOUBLE_BIT\`) the two-sided one. */
fn vsmRenderTierOf(corners:u32)->u32{
 let n=corners&(VSM_RENDER_DOUBLE_BIT-1u);
 let q=max((n+VSM_RENDER_TIER_CORNERS-1u)/VSM_RENDER_TIER_CORNERS,1u);
 let t=select(firstLeadingBit(q-1u)+1u,0u,q==1u);
 let family=select(select(0u,VSM_RENDER_FAMILY_TWO_SIDED,(corners&VSM_RENDER_DOUBLE_BIT)!=0u),VSM_RENDER_FAMILY_VOXEL,(corners&VSM_RENDER_VOXEL_BIT)!=0u);
 return family*VSM_RENDER_CORNER_TIERS+min(t,VSM_RENDER_CORNER_TIERS-1u);
}
/** The corners a record of tier \`tier\` draws (\`vsmRenderTierCorners\`). */
fn vsmRenderTierCorners(tier:u32)->u32{return VSM_RENDER_TIER_CORNERS<<(tier%VSM_RENDER_CORNER_TIERS);}
/** The records the view pass draws: those the cull stored, within the list's capacity. */
fn vsmRenderRecordTotal(emitted:u32)->u32{return min(emitted,params.recordCapacity);}
`,
)

/** The software raster's two bins' records, the dynamic layer's and the static layer's, among the
 *  \`total\` records the list holds: the counts the cull made (\`counts\`, the program's), held to
 *  the list. */
export const VSM_RENDER_SOFTWARE_COUNTS_WGSL = wgslBlock(
  'VSM_RENDER_SOFTWARE_COUNTS_WGSL',
  [VSM_RENDER_PARAMS_WGSL],
  `fn vsmRenderSoftwareCounts(total:u32)->vec2u{
 let dynamicHeld=min(atomicLoad(&counts[VSM_RENDER_TIER_RECORDS+VSM_RENDER_SOFTWARE_BIN]),total);
 return vec2u(dynamicHeld,min(atomicLoad(&counts[VSM_RENDER_TIER_RECORDS+VSM_RENDER_SOFTWARE_STATIC_BIN]),total-dynamicHeld));
}`,
)

/**
 * A record of the raster, as the cull emits it (`vec4u`, `renderCullWgsl.ts`): x the caster's row;
 * y the map's id | mip << 16 | no near clip << 20 | static << 21 | swapped << 22 | tessellated <<
 * 23 | bin << 24 | deforms << 28 | offset allowed << 29 | level of detail behind << 30 (the bin: the
 * hardware tier or a software bin); z the window's first page, x | y << 8, and its last
 * (inclusive), x << 16 | y << 24; w the window's pages to draw, bit (y · `VSM_RENDER_WINDOW_PAGES` + x)
 * from its first. The decoding the bin, the raster, the voxel raster and the tessellation share.
 */
export const VSM_RENDER_RECORD_WGSL = wgslBlock(
  'VSM_RENDER_RECORD_WGSL',
  [],
  `fn vsmRecordMap(r:vec4u)->u32{return r.y&0xFFFFu;}
fn vsmRecordMip(r:vec4u)->u32{return (r.y>>16u)&7u;}
/** A clipmap level has no near clip (a directional map). */
fn vsmRecordNoNearClip(r:vec4u)->bool{return ((r.y>>20u)&1u)!=0u;}
fn vsmRecordStatic(r:vec4u)->u32{return (r.y>>21u)&1u;}
fn vsmRecordSwapped(r:vec4u)->bool{return ((r.y>>22u)&1u)!=0u;}
fn vsmRecordTessellated(r:vec4u)->bool{return ((r.y>>23u)&1u)!=0u;}
fn vsmRecordTier(r:vec4u)->u32{return (r.y>>24u)&15u;}
/** Whether the record is a software bin's (\`renderSoftwareWgsl.ts\`): the software bins are the last. */
fn vsmRecordSoftware(r:vec4u)->bool{return vsmRecordTier(r)>=${VSM_RENDER_SOFTWARE_BIN}u;}
fn vsmRecordDeforms(r:vec4u)->bool{return ((r.y>>28u)&1u)!=0u;}
fn vsmRecordOffsetAllowed(r:vec4u)->bool{return ((r.y>>29u)&1u)!=0u;}
fn vsmRecordLodBehind(r:vec4u)->bool{return ((r.y>>30u)&1u)!=0u;}
fn vsmRecordFirstPage(r:vec4u)->vec2u{return vec2u(r.z&0xFFu,(r.z>>8u)&0xFFu);}
fn vsmRecordLastPage(r:vec4u)->vec2u{return vec2u((r.z>>16u)&0xFFu,r.z>>24u);}
/** Whether the record draws page \`local\` of its window, counted from its first page. */
fn vsmRecordDrawsPage(r:vec4u,local:vec2u)->bool{
 let last=vsmRecordLastPage(r)-vsmRecordFirstPage(r);
 return all(local<=last)&&((r.w>>(local.y*${VSM_RENDER_WINDOW_PAGES}u+local.x))&1u)!=0u;
}`,
)

/**
 * One-thread kernels writing the next stage's indirect arguments. Group 0: 0 params, 1 counters
 * (rw atomic), 2 arguments (rw, `VSM_RENDER_ARGS_WORDS`), 3 the stats, where a records count found past
 * the room sets the records' overflow flag (`VSM_OVERFLOW_RECORDS`).
 */
export const VSM_RENDER_ARGS_WGSL = wgslProgram(
  `
@group(0) @binding(0) var<uniform> params:VsmRenderParams;
@group(0) @binding(1) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
@group(0) @binding(3) var<storage,read_write> vsmStats:array<atomic<u32>>;
fn vsmRenderArgsGrid(word:u32,groups:u32,z:u32){
 let g=groupGrid(groups);
 args[word]=g.x;args[word+1u]=g.y;args[word+2u]=z;
}
/** The cull's dispatch, once the candidates and the pass's lights are known: a thread a candidate
 *  over x and y, a listed light a z. */
@compute @workgroup_size(1) fn vsmRenderArgsCull(){
 let n=atomicLoad(&counts[0]);
 let lights=min(atomicLoad(&counts[VSM_RENDER_COUNT_VIEWS]),params.lightCount);
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_CULL}u,ceilDiv(n,WORKGROUP_THREADS),select(0u,lights,n>0u));
}
/** The occlusion's second cull, once the first's records are binned and drawn: a thread a record the
 *  first held back; the list's places start again beside those, the tiers empty. And the post cull,
 *  a thread a caster the descent's post pass found since (\`VSM_RENDER_COUNT_CAST_FIRST\`), over every
 *  listed light. */
@compute @workgroup_size(1) fn vsmRenderArgsSecond(){
 let held=atomicLoad(&counts[VSM_RENDER_COUNT_HELD]);
 atomicStore(&counts[VSM_RENDER_COUNT_TAKEN],held);
 atomicStore(&counts[VSM_RENDER_COUNT_RECORDS],0u);
 for(var t=0u;t<VSM_RENDER_BINS;t++){atomicStore(&counts[VSM_RENDER_TIER_RECORDS+t],0u);}
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_CULL}u,ceilDiv(held,WORKGROUP_THREADS),1u);
 let casters=atomicLoad(&counts[0]);
 let found=select(0u,casters-atomicLoad(&counts[VSM_RENDER_COUNT_CAST_FIRST]),casters>atomicLoad(&counts[VSM_RENDER_COUNT_CAST_FIRST]));
 let lights=min(atomicLoad(&counts[VSM_RENDER_COUNT_VIEWS]),params.lightCount);
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_POST}u,ceilDiv(found,WORKGROUP_THREADS),select(0u,lights,found>0u));
}
/** Once the cull ran: the reserve of the bins — the software raster's records first, the dynamic
 *  layer's then the static layer's, then each tier's cursor at its first place, after the lower
 *  tiers' records —, the bin's dispatch, the software raster's (a group a record of each layer), a
 *  thread a record, the draws, one a tier, each from its first record by its first vertex (vertex k
 *  of record p is vertex p · corners + k). */
@compute @workgroup_size(1) fn vsmRenderArgsBin(){
 let emitted=atomicLoad(&counts[VSM_RENDER_COUNT_RECORDS]);
 let total=vsmRenderRecordTotal(emitted);
 if(emitted>params.recordCapacity){atomicOr(&vsmStats[VSM_OVERFLOW_FLAGS],VSM_OVERFLOW_RECORDS);}
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_BIN}u,ceilDiv(total,WORKGROUP_THREADS),1u);
 // The software raster's records first, a group each: the dynamic layer's, then the static layer's.
 let software=vsmRenderSoftwareCounts(total);
 atomicStore(&counts[VSM_RENDER_TIER_CURSOR+VSM_RENDER_SOFTWARE_BIN],0u);
 atomicStore(&counts[VSM_RENDER_TIER_CURSOR+VSM_RENDER_SOFTWARE_STATIC_BIN],software.x);
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_SOFTWARE}u,software.x,1u);
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_SOFTWARE_STATIC}u,software.y,1u);
 var first=software.x+software.y;
 for(var t=0u;t<VSM_RENDER_TIERS;t++){
  let start=min(first,total);
  let end=min(first+atomicLoad(&counts[VSM_RENDER_TIER_RECORDS+t]),total);
  atomicStore(&counts[VSM_RENDER_TIER_CURSOR+t],start);
  let corners=vsmRenderTierCorners(t);
  let at=${VSM_RENDER_ARGS_DRAW}u+4u*t;
  args[at]=(end-start)*corners;args[at+1u]=1u;args[at+2u]=start*corners;args[at+3u]=0u;
  first=end;
 }
}
`,
  [
    VSM_RENDER_PARAMS_WGSL,
    VSM_RENDER_SOFTWARE_COUNTS_WGSL,
    GROUP_GRID_WGSL,
    WORKGROUP_THREADS_WGSL,
    ceilDivWgsl,
    VSM_OVERFLOW_WGSL,
  ],
)
