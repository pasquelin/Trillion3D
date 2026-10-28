import { wgslConsts } from '../../../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { ceilDivWgsl } from '../../../../../../math/src/wgsl/integer.ts'
import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import { LIGHTING_CHANNELS_WGSL } from '../../../lightingChannelsWgsl.ts'
import { VSM_OVERFLOW_WGSL } from '../overflowWgsl.ts'
import { VSM_PROJECTION_RECORD_WGSL } from '../projection/projectionDataWgsl.ts'
import { vsmNinthStorage } from '../resources.ts'
import { WINDOW_PAGE_SIDE } from '../../../../visibility/tessellation/contract.ts'
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
const VSM_RENDER_CORNER_TIERS = 4
const VSM_RENDER_TIER_CORNERS = 96
const VSM_RENDER_DOUBLE_BIT = 0x4000
const VSM_RENDER_VOXEL_BIT = 0x8000
export const VSM_RENDER_FAMILY = { oneSided: 0, twoSided: 1, voxel: 2 } as const
const VSM_RENDER_TIERS = Object.keys(VSM_RENDER_FAMILY).length * VSM_RENDER_CORNER_TIERS
/** The software raster's bins (`renderSoftwareWgsl.ts`), after the hardware tiers: the records of
 *  the clusters small enough in their map's mip view (`vsmRenderSoftware`), each a window of
 *  `VSM_RENDER_WINDOW_PAGES_SOFTWARE` pages a side, rastered in compute, the dynamic layer's in the
 *  first bin and the static layer's in the second (the second dispatch launches a group for the
 *  static layer's alone). Their records lie first in the sorted list, their counts in the list's
 *  word past the capacity (`vsmRenderBin`), the views of the maps they are drawn in, where the stage
 *  does not bind the projection data, after it (`VSM_RENDER_SOFTWARE_VIEWS_WGSL`). */
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
/** The pages a side of the window a record draws spans: the reference's raster windows, the cull
 *  emitting a record a window of a caster's page rect and the raster drawing it over a viewport of
 *  that many pages (`renderRasterWgsl.ts`): the hardware raster's (`VSM_RASTER_WINDOW_PAGES`, 4) and
 *  the software raster's (`NANITE_VSM_PAGE_TABLE_CACHE_DIM`, 8, the page table entries its group
 *  keeps in its own memory, `renderSoftwareWgsl.ts`). */
export const VSM_RENDER_WINDOW_PAGES = 4
export const VSM_RENDER_WINDOW_PAGES_SOFTWARE = WINDOW_PAGE_SIDE
/** Words of a view pass's indirect arguments: the cull's 3; the bin's 3, a thread a record
 *  (`vsmRenderBin`); then a draw of 4 a tier; then the software raster's 3 a layer, a group a record
 *  of the layer (the dynamic layer's, then the static layer's), and 3 for both layers at once, a group
 *  a record of either (`vsmSoftwareMerged`). */
export const VSM_RENDER_ARGS_CULL = 0
export const VSM_RENDER_ARGS_BIN = 3
export const VSM_RENDER_ARGS_DRAW = 6
export const VSM_RENDER_ARGS_SOFTWARE = VSM_RENDER_ARGS_DRAW + 4 * VSM_RENDER_TIERS
export const VSM_RENDER_ARGS_SOFTWARE_STATIC = VSM_RENDER_ARGS_SOFTWARE + 3
export const VSM_RENDER_ARGS_SOFTWARE_ALL = VSM_RENDER_ARGS_SOFTWARE_STATIC + 3
/** And the post cull's: a thread a caster the descent's post pass found, a listed map a z. */
export const VSM_RENDER_ARGS_POST = VSM_RENDER_ARGS_SOFTWARE_ALL + 3
export const VSM_RENDER_ARGS_WORDS = VSM_RENDER_ARGS_POST + 3
/** Counter words: [0] the candidates; [1] the pages the shadow views' descent listed within its
 *  room, which the casters' kernel runs over, [2] the first of them the running pass of the descent
 *  listed (none in the main pass), [3] the casters found before the descent's post pass; then the
 *  view pass's own, cleared before each pass from `VSM_RENDER_COUNT_PASS`: [4] the maps the GPU
 *  listed — those with a page to draw —, a group each, [5] the mip views listed in the groups' runs (`renderViewsWgsl.ts`),
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
/** The compute throttle's cluster counts (`../throttle.ts`), laid as a header of the totals then an entry
 *  for each map slot, each the clusters of the hardware raster (`VSM_FEEDBACK_HW`) and of the software
 *  raster (`VSM_FEEDBACK_SW`). The throttled cull counts them past the counters, in the same buffer
 *  (`vsmFeedbackWords`); the frame copies them out whole. */
const VSM_FEEDBACK_HW = 0
const VSM_FEEDBACK_SW = 1
const VSM_FEEDBACK_HEADER_WORDS = 2
const VSM_FEEDBACK_ENTRY_WORDS = 2
/** The words of the counts of `mapSlots` map slots. */
export const vsmFeedbackWords = (mapSlots: number) =>
  VSM_FEEDBACK_HEADER_WORDS + VSM_FEEDBACK_ENTRY_WORDS * mapSlots
/** The counters' words with `feedbackWords` words of feedback past them (none: the counters alone). */
export const vsmCountWords = (feedbackWords = 0) => VSM_RENDER_COUNT_WORDS + feedbackWords
/** The feedback's layout, for the shaders that count it or read it. */
export const VSM_FEEDBACK_WGSL = wgslBlock(
  'VSM_FEEDBACK_WGSL',
  [],
  wgslConsts({
    VSM_FEEDBACK_HW,
    VSM_FEEDBACK_SW,
    VSM_FEEDBACK_HEADER_WORDS,
    VSM_FEEDBACK_ENTRY_WORDS,
    VSM_RENDER_FEEDBACK: VSM_RENDER_COUNT_WORDS,
  }),
)
/** The bits of a listed map's group that hold the stale layers of all its mips together (bit 0 the dynamic
 *  layer's, bit 1 the static's): the cull leaves the map out for a caster of a layer none has. */
const VSM_RENDER_VIEW_LAYERS_MASK = 3
/** From this bit, a listed map's group carries its light's lighting channels, as a mask
 *  (\`vsmRenderViews\`): the cull leaves out a caster that shares none (\`VSM_RENDER_CAND_CHANNELS_SHIFT\`). */
const VSM_RENDER_VIEW_CHANNELS_SHIFT = 4
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
 * the view: its eye (split double), for the draw distances and the size of an object on it;
 * `threshold` is the error in a map's pixels a cluster drawn in it may show, the cut's threshold
 * scaled by the shadows' level-of-detail bias (`shadowGeometryLodBias`); `worldLinks`, the cold word
 * its cut's world links start at, zero for a cut that follows no world, whose switch the casters obey
 * (`VsmRenderScene.world`); `drawDistances`, the draw distances the casters take, from the main view's eye and scaled by
 * `viewDistanceScale` (`vsmRenderOutsideDrawDistance`): bit 0 those of the objects of their own,
 * bit 1 those of the instances of an instanced mesh, 0 when none does; `filterBase`, the
 * word of the bits the main view's filter holds (`vsmRenderFilteredOut`) its candidates read in their
 * group 1, zero for a view that filters none. A slot belongs to one view pass
 * (`renderViewPasses.ts`): `viewFirst` and `viewCount` are the ids of its maps (`vsmRenderViews`: the groups, a map each at most,
 * are listed in the first `viewCount` places of its list, and the mip views begin after them); `lightCount`, the
 * lights of the frame (its table);
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
  ['viewCount', 'u32'],
  ['viewFirst', 'u32'],
  ['lightCount', 'u32'],
  ['recordCapacity', 'u32'],
  ['worldLinks', 'u32'],
  ['drawDistances', 'u32'],
  ['viewDistanceScale', 'f32'],
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
  [VSM_RENDER_PARAMS_STRUCT_WGSL, LIGHTING_CHANNELS_WGSL],
  `
/** A caster: a resident cluster that may cast, whatever level of detail a map takes of it. Its world
 *  sphere (centre high + radius, centre low) and its world box about that centre (its three half
 *  axes, \`a0\` to \`a2\`: what the frustum cull tests; the sphere is what the light's range, the
 *  level of detail and the raster choice measure), its row, corners and flags (bit 0 cache as
 *  dynamic, bit 1 deforming: it invalidates the pages it draws), and its longest edge in world units
 *  (\`edge\`, 0 for none known), which picks its raster. Then what each map judges its level of detail by (\`vsmRenderLodAt\`):
 *  its own bounds and its parent group's, each a centre from the world sphere's and a radius in
 *  world units, and both errors in world units, scaled as the camera's cut scales them (the
 *  placement's smallest axis scale) — the parent's negative for a root; the square of
 *  the distance past which its object stops evaluating its offset (\`offsetDisableSq\`, 0 for never,
 *  given to every cluster of a placement whose offset may invalidate its shadows).
 *  Last, how far its centre moved since the previous image (\`prevShift\`) and the half axes of its box under
 *  the placement's previous pose: the occlusion's first
 *  cull tests the box where that image drew it; the placement's cache state per view (\`viewBits\`: bits
 *  0..15 cached as dynamic, 16..31 turned this frame), and the ball of the whole object the cluster
 *  belongs to, a centre from the world sphere's and a radius (\`inst\`): what a map judges whether
 *  the object stays out of the coarse pages by. Its half axes hold the reach of the placement's
 *  offset (\`casterSphere\`). The twelve floats that close it fill the pads of its vec3 members: the factor
 *  each half axis keeps where a map does not grow the bounds by that reach (\`vsmOffsetGrows\`), one for
 *  a placement with none (\`vsmCandFit\`), then the three half axes of the previous pose
 *  (\`vsmCandPrevAxes\`), left out for a placement that stood still (\`VSM_RENDER_CAND_STILL\`). */
struct VsmRenderCandidate{c:vec4f,l:vec3f,row:u32,a0:vec3f,corners:u32,a1:vec3f,flags:u32,a2:vec3f,prevShift:vec3f,edge:f32,own:vec4f,parent:vec4f,inst:vec4f,errors:vec2f,offsetDisableSq:f32,viewBits:u32,tail0:vec4f,tail1:vec4f,tail2:vec4f,tess:vec4f,}
const VSM_RENDER_CAND_DYNAMIC:u32=1u;
const VSM_RENDER_CAND_DEFORMING:u32=2u;
/** Bit 2: the row's triangles face the light clockwise in world space — a mirroring placement
 *  or a back-side row (\`FLAG_BACK\`), not both (\`vsmRenderCaster\`). */
const VSM_RENDER_CAND_FLIPPED:u32=4u;
/** Bit 5: the row is a displaced surface the frame tessellates (\`tessellatedFlags\`) while a kind of
 *  light's maps take it so (\`params.tessellated\`): its records are cut into patches and not drawn as
 *  its triangles, a masked one too: its cutout is judged at the patches' vertices (\`vsmTessDiceWgsl\`). */
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
/** Bit 14: the placement's linear part is the one the previous image drew it with, so the box it drew
 *  has the half axes the box has now (\`vsmCandPrevAxes\`). */
const VSM_RENDER_CAND_STILL:u32=16384u;
/** Bits 15 to 17: the lighting channels of the candidate's object, as a mask (\`LIGHTING_CHANNELS_ALL\`),
 *  from this bit: a light's maps draw it only where they share a channel (\`VSM_RENDER_VIEW_CHANNELS_SHIFT\`). */
const VSM_RENDER_CAND_CHANNELS_SHIFT:u32=15u;
/** The factor each half axis of the candidate's box keeps where a map does not grow the bounds by its
 *  placement's offset. */
fn vsmCandFit(c:VsmRenderCandidate)->vec3f{return c.tail0.xyz;}
/** Whether a displaced surface of the candidate, seen from a map's mip view of \`focal\` pixels a unit at depth one and from \`depth\` (the nearest depth of its object's ball, 1 in an orthographic
 *  view), has its displacement gone: the greatest distance it moves a point, in pixels, at or under the size it fades out below (\`tess.x\`, \`tess.y\`: none for a surface that
 *  is not displaced, never fades or is masked). The surface is then drawn as its base triangles, not cut into patches. */
fn vsmRenderFallsBack(c:VsmRenderCandidate,focal:f32,depth:f32)->bool{
 return c.tess.y>0.0&&depth>0.0&&c.tess.x*focal/depth<=c.tess.y;
}
/** The half axes of the candidate's box under the pose the previous image drew its placement in: the
 *  current ones for a placement that stood still, else those the record holds in its pads. */
fn vsmCandPrevAxes(c:VsmRenderCandidate)->array<vec3f,3>{
 if((c.flags&VSM_RENDER_CAND_STILL)!=0u){return array<vec3f,3>(c.a0,c.a1,c.a2);}
 return array<vec3f,3>(vec3f(c.tail0.w,c.tail1.xy),vec3f(c.tail1.zw,c.tail2.x),c.tail2.yzw);
}
/** Whether a caster of flags \`candFlags\` and a light's listed group of flags \`viewFlags\`
 *  (\`vsmRenderViews\`) share a lighting channel: the one test of the channels, the cull's. */
fn vsmCandSharesChannel(candFlags:u32,viewFlags:u32)->bool{
 return (((candFlags>>VSM_RENDER_CAND_CHANNELS_SHIFT)&LIGHTING_CHANNELS_ALL)&(viewFlags>>VSM_RENDER_VIEW_CHANNELS_SHIFT))!=0u;
}
/** The cut rule's verdicts on a candidate in a map's mip view (\`vsmRenderLodAt\`). */
const VSM_RENDER_LOD_NOT_DRAWN:u32=0u;
const VSM_RENDER_LOD_OWN:u32=1u;
const VSM_RENDER_LOD_BEHIND:u32=2u;
${wgslConsts({
  VSM_RENDER_VIEW_CHANNELS_SHIFT,
  VSM_RENDER_VIEW_LAYERS_MASK,
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
  VSM_RENDER_WINDOW_PAGES_SOFTWARE,
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

/** The storage buffers a stage of the software raster binds with one pool slice: the page rows' five, the
 *  sorted records, the page table and the slice. */
const SOFTWARE_STORAGE = 8

/** Whether the software raster rasters both layers' records in one dispatch, as the reference's does: a
 *  device that grants one storage buffer more than `SOFTWARE_STORAGE` a stage binds both pool slices, and
 *  the dynamic layer's records and the static layer's go to the slice of their layer
 *  (`renderSoftwareWgsl.ts`). A device that grants no more binds one slice a dispatch: the dynamic
 *  layer's records, then the static layer's, the same pixels. */
export const vsmSoftwareMerged = (device: Pick<GPUDevice, 'limits'>) =>
  device.limits.maxStorageBuffersPerShaderStage > SOFTWARE_STORAGE

/** Whether the software raster reads the views of the maps a pass draws from the sorted list, laid
 *  there for it (`VSM_RENDER_SOFTWARE_VIEWS_WGSL`): a device with no storage buffer past those the stage's
 *  two pool slices take (`SOFTWARE_STORAGE` + 2) binds the page table in the place of the projection
 *  data. A device that has one binds the projection data and reads the record of the map, the same
 *  words. */
export const vsmViewsLaid = (device: Pick<GPUDevice, 'limits'>) =>
  device.limits.maxStorageBuffersPerShaderStage < SOFTWARE_STORAGE + 2

/** The storage buffers a stage of the cull binds when it marks the pages it emits drawn: the eight it binds
 *  otherwise, the page table and the raster marks. */
const CULL_MARKS_STORAGE = 10

/** Whether the cull marks the pages of the records it emits drawn, and leaves out the pages that are not
 *  ones to draw (`vsmRenderEmit`), as the reference's cluster cull does: a device that grants ten storage
 *  buffers a stage (`CULL_MARKS_STORAGE`) binds the page table and the raster marks in the cull. A device
 *  that grants fewer has the bin that follows mark the pages of the record's rect that the cull matched,
 *  the same marks, and the raster leave out the pages that are not ones to draw (`vsmRenderPageOrigin`). */
export const vsmCullMarks = (device: Pick<GPUDevice, 'limits'>) =>
  device.limits.maxStorageBuffersPerShaderStage >= CULL_MARKS_STORAGE

/** The views of the maps a view pass draws, laid after the sorted list's counts word
 *  (`vsmRenderLayViews`) for the software raster to read in place of the projection data it does not
 *  bind (`vsmViewsLaid`; `renderSoftwareWgsl.ts`): `VSM_RENDER_SOFTWARE_VIEW_RECORDS` records a map,
 *  from the pass's first map: the four columns of its shifted-to-map matrix, then its origin shift's
 *  high part with the offsets' threshold, then its low part. One pair writes and reads them, as the
 *  fields of the projection record that the corners are placed by. */
export const VSM_RENDER_SOFTWARE_VIEW_RECORDS = 6
/** The words of a view (`vsmPackView`, `vsmUnpackView`): what the pass's sorted list lays and what a window of the
 *  tessellation's `tess` buffer holds of its map's view (`WINDOW_VIEW_WORDS`). */
export const VSM_VIEW_WORDS_WGSL = wgslBlock(
  'VSM_VIEW_WORDS_WGSL',
  [VSM_PROJECTION_RECORD_WGSL],
  `${wgslConsts({ VSM_RENDER_SOFTWARE_VIEW_RECORDS })}
/** The words of the view of a map's record, as the list holds them. */
fn vsmPackView(raw:VsmProjectionRecord)->array<vec4u,${VSM_RENDER_SOFTWARE_VIEW_RECORDS}>{
 let m=raw.shiftedToMapUv;
 return array<vec4u,${VSM_RENDER_SOFTWARE_VIEW_RECORDS}>(
  bitcast<vec4u>(m[0]),bitcast<vec4u>(m[1]),bitcast<vec4u>(m[2]),bitcast<vec4u>(m[3]),
  bitcast<vec4u>(vec4f(raw.originShiftHigh,raw.wpoThreshold)),bitcast<vec4u>(vec4f(raw.originShiftLow,0.0)));
}
/** The fields of a map's record that a view holds, from its words. */
fn vsmUnpackView(view:array<vec4u,${VSM_RENDER_SOFTWARE_VIEW_RECORDS}>)->VsmProjectionRecord{
 var raw:VsmProjectionRecord;
 raw.shiftedToMapUv=mat4x4f(bitcast<vec4f>(view[0]),bitcast<vec4f>(view[1]),bitcast<vec4f>(view[2]),bitcast<vec4f>(view[3]));
 let high=bitcast<vec4f>(view[4]);
 raw.originShiftHigh=high.xyz;
 raw.wpoThreshold=high.w;
 raw.originShiftLow=bitcast<vec4f>(view[5]).xyz;
 return raw;
}`,
)
export const VSM_RENDER_SOFTWARE_VIEWS_WGSL = wgslBlock(
  'VSM_RENDER_SOFTWARE_VIEWS_WGSL',
  [VSM_RENDER_PARAMS_WGSL, VSM_VIEW_WORDS_WGSL],
  `/** The place in the sorted list of map \`map\`'s view: past the records and the counts' word. */
fn vsmSoftwareViewAt(map:u32)->u32{
 return params.recordCapacity+1u+(map-params.viewFirst)*VSM_RENDER_SOFTWARE_VIEW_RECORDS;
}`,
)

/**
 * A record of the raster, as the cull emits it (`vec4u`, `renderCullWgsl.ts`): x the caster's row;
 * y the map's id | mip << 16 | the pages' mark transitioned << 19 | no near clip << 20 | static << 21 |
 * swapped << 22 | tessellated << 23 | bin << 24 | deforms << 28 | offset allowed << 29 | level of
 * detail behind << 30 | the primary request mark << 31 (the bin: the hardware tier or a software
 * bin; the marks: the mask the cull matched the window's pages by, `vsmRecordMarkWanted`,
 * `vsmRecordMarkPrimary`); z the
 * window's first page, x | y << 8, and its last (inclusive), x << 16 | y << 24; w none: the bin puts
 * there the page table's index of the window's first page (`renderBinWgsl.ts`), which both rasters
 * read the window's pages from. The raster draws every page of the rect that is a page to draw. The
 * decoding the bin, the raster, the voxel raster and the tessellation share.
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
/** The pages the rect spans past its first, a side: its last page less its first, x | y << 8
 *  (\`vsmExtentPages\`); a page counted from the first lies in the rect when it is within it. */
fn vsmRecordExtent(r:vec4u)->u32{
 let e=vsmRecordLastPage(r)-vsmRecordFirstPage(r);
 return e.x|(e.y<<8u);
}
fn vsmExtentPages(extent:u32)->vec2u{return vec2u(extent&0xFFu,extent>>8u);}
/** Whether slot \`slot\` of the software raster's window (\`${VSM_RENDER_WINDOW_PAGES_SOFTWARE}\` pages a side, row by row) lies in the record's rect. */
fn vsmRenderWindowHas(r:vec4u,slot:u32)->bool{
 let side=${VSM_RENDER_WINDOW_PAGES_SOFTWARE}u;
 return all(vec2u(slot%side,slot/side)<=vsmRecordLastPage(r)-vsmRecordFirstPage(r));
}
/** Whether the cull matched the window's pages by the wanted mark (a cache state that turned), and by
 *  the primary request mark too (a caster in a prefiltered level's inner band): the rest of the mask
 *  is the layer's stale mark (\`renderBinWgsl.ts\`). */
fn vsmRecordMarkWanted(r:vec4u)->bool{return ((r.y>>19u)&1u)!=0u;}
fn vsmRecordMarkPrimary(r:vec4u)->bool{return (r.y>>31u)!=0u;}`,
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
 *  over x and y, a listed map a z. */
@compute @workgroup_size(1) fn vsmRenderArgsCull(){
 let n=atomicLoad(&counts[0]);
 let groups=min(atomicLoad(&counts[VSM_RENDER_COUNT_VIEWS]),params.viewCount);
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_CULL}u,ceilDiv(n,WORKGROUP_THREADS),select(0u,groups,n>0u));
}
/** The occlusion's second cull, once the first's records are binned and drawn: a thread a record the
 *  first held back; the list's places start again beside those, the tiers empty. And the post cull,
 *  a thread a caster the descent's post pass found since (\`VSM_RENDER_COUNT_CAST_FIRST\`), over every
 *  listed map. */
@compute @workgroup_size(1) fn vsmRenderArgsSecond(){
 let held=atomicLoad(&counts[VSM_RENDER_COUNT_HELD]);
 atomicStore(&counts[VSM_RENDER_COUNT_TAKEN],held);
 atomicStore(&counts[VSM_RENDER_COUNT_RECORDS],0u);
 for(var t=0u;t<VSM_RENDER_BINS;t++){atomicStore(&counts[VSM_RENDER_TIER_RECORDS+t],0u);}
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_CULL}u,ceilDiv(held,WORKGROUP_THREADS),1u);
 let casters=atomicLoad(&counts[0]);
 let found=select(0u,casters-atomicLoad(&counts[VSM_RENDER_COUNT_CAST_FIRST]),casters>atomicLoad(&counts[VSM_RENDER_COUNT_CAST_FIRST]));
 let groups=min(atomicLoad(&counts[VSM_RENDER_COUNT_VIEWS]),params.viewCount);
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_POST}u,ceilDiv(found,WORKGROUP_THREADS),select(0u,groups,found>0u));
}
/** Once the cull ran: the reserve of the bins — the software raster's records first, the dynamic
 *  layer's then the static layer's, then each tier's cursor at its first place, after the lower
 *  tiers' records —, the bin's dispatch, a thread a record, the software raster's (a group a record of
 *  each layer, and of both at once), the draws, one a tier, each from its first record by its first vertex (vertex k of record p is
 *  vertex p · corners + k). */
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
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_SOFTWARE_ALL}u,software.x+software.y,1u);
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
