# Shadows

How the WebGPU engine draws cast shadows: virtual shadow maps whose pages exist only where the image
reads them. Lights, tiles and the sampled resolve are [ENGINE.md](ENGINE.md#direct-lighting); the
options a page sets (`castShadow`, `transparentShadow`) are [SDK.md](SDK.md#lights).

## Pages and the pool

Every shadow light has a virtual map cut into pages of 128 texels, one page-table word per virtual
page. Pages are drawn in a pool sized from what the scene reads (`poolDemand.ts`), allocated only
once a light casts: a world without one pays neither its bytes nor its per-frame work.

A pixel reads the level whose texel is at most its footprint and more than half of it, so a
`64 × 64`-pixel tile on one surface reads at most the 2 × 2 pages it straddles, plus a third while
coarser levels stand in for pages not drawn yet: a frame asks for at most
`⁴⁄₃ · 4 · ⌈2W / 128⌉ · ⌈2H / 128⌉` pages (`shadowPoolSize`): a bound the memory budget reserves at
3840 × 2160, never what the pool holds. A real frame reads far less — a one-cube scene a few
hundred pages at 3456 × 2234 —, so the pool holds what the latest report asked, twice — the report
being read and the next — and a quarter more (`demandPoolPages`), in the fewest square layers the
device's texture side holds (`shadowPoolShape`, `webgpu/shadow/poolSize.ts`). A lamp face's finest
mip is 32 × 32 pages (`lampFaceSize`).

| Case                                                                            | Pages                        | Pool                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| first frame, before any report                                                  | the seed (`SEED_POOL_PAGES`) | 16 × 16 = 256 pages, a 2 048² depth texture of 16 MiB                                                                                                       |
| a frame that asks 300 pages                                                     | 750 held                     | 28 × 28 = 784 pages, 49 MiB; as much again for the static layer once something moves; half as much for the transmittance layer once a blended surface casts |
| a frame that asks 2 000 pages                                                   | 5 000 held                   | two layers of 51² (5 202 pages, 325 MiB) on a device 8 192 texels wide                                                                                      |
| the cap, the grant's atlas share (`SHADOW_ATLAS_BYTES`, one sun at 3840 × 2160) | —                            | two layers of 53², 5 618 pages, 351 MiB                                                                                                                     |

The first frame a light casts grants the seed. After each report the pool follows the demand
(`webgpu/shadow/poolResize.ts`, #1208, #1345): a report that asks more than half the pool — the
two reports it holds would not fit — grows it; one that asks for a pool at most half as large,
sixty reports in a row (`SHRINK_REPORTS`), shrinks it to the most they asked. A resize is by the
same rule and grant, the frame held while the device answers: every page that
fits keeps its entry, state and depth, copied texel for texel with its transmittance
(`gpu/shadow/pageMoves.ts`), since reads are texel-exact (#831), so nothing is drawn again; a
smaller pool keeps the pages it would evict last, every floor first. The batch capacity and request
list follow the pool; the static layer is rebuilt at the new size by the next move. A refused
resize keeps the pool, said under `gpu-out-of-memory`, and is not asked again until the demand asks
another size. A demand past the cap is held there, said `ceiling` in the `shadow-pool` diagnostic. What the pool cannot hold is refused at
allocation, published as memory (`shadowPagesOverflow`, #542) and read at the coarser level; pages
are evicted least recently read first.

## Memory

The table gives each of the 64 shadow slices (`MAX_SHADOW_SLICES`) a fixed window of the largest
range a light needs, a whole sun's 16 × 64 × 64 words (`SHADOW_TABLE_STRIDE`): 2^22 words, 16 MiB
(`SHADOW_TABLE_ENTRIES`). The GPU total's shadow share counts it with the pool
(`SHADOW_POOL_BYTES`, 899 MiB); less the batches' 5.0 MiB reserve, that share is the shadows' one
grant (`SHADOW_GRANT_BYTES`, 894 MiB: the largest pool, its static layer, its transmittance layer,
the table and the page requests, `webgpu/shadow/memoryGrant.ts`). A late allocation — static or
transmittance layer — is asked of the grant with what is held, then of the device under an
out-of-memory check, never inside a frame (`webgpu/shadow/transmittanceGrant.ts`). A scene whose
blended surfaces cast asks the transmittance layer with the pool; one turned casting later, by a
rewrite of its values, asks it at that rewrite, the frame held until the layer lands, then draws
every mapped page again with it: no frame is drawn without the layer.

Memory pressure never passes for performance: it lowers no page to meet a frame time, and each
pressure is a named event in `shadowMemoryEvents`; `shadowPeakBytes` is the most the grant held.

| Event                                                                   | Outcome                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pool-shrunk`                                                           | a refused pool is drawn smaller, its halvings in `shadowResolutionBias` (0 normally)                   |
| `pool-refused`                                                          | no pool: the `shadows-off` error                                                                       |
| `static-layer-over-grant`, `static-layer-refused` (`gpu-out-of-memory`) | no static layer; every page is drawn whole, every caster at once: no shadow is lost                    |
| `transmittance-over-grant`, `transmittance-refused`                     | no transmittance layer, never asked again: opaque shadows whole, blended casters cast nothing, by name |

The host mirror — the words, a change flag per word, the pool's page records and eviction bitset,
the frame's page list (`admit.ts`) at the largest pool, and the batches' host lists
(`SHADOW_BATCH_HOST_BYTES`) — is 25.9 MiB (`SHADOW_HOST_BYTES`, summed from
`shadowTableHostBytes`, `shadowPoolHostBytes`, `shadowAdmissionHostBytes` and `batchBudget.ts`,
checked by tests against real allocations), the CPU total's first share, before the decoded-page
cache (`splitMemoryBudget`). The batches' buffers (`gpu/shadow/batchBudget.ts`, `batchWrites.ts`):

| Buffer                                                                                                                                               | Size                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| staging of every batch but the first, made at the first staged write at its frame's reserved capacity, remade once at most by a frame reserving more | at most 170 × 28 284 bytes, 4.59 MiB                                                                |
| light cut's flag words, one per batch for 8 frames in flight (`SHADOW_FLAG_FRAMES`)                                                                  | 5 472 bytes                                                                                         |
| CPU cut's commands for 4 104 faces                                                                                                                   | 65 664 bytes                                                                                        |
| region commands a sampled frame copies (the cull's two lists, the occlusion count)                                                                   | 3 × 131 328 bytes                                                                                   |
| **total**                                                                                                                                            | 5.03 MiB GPU in `SHADOW_POOL_BYTES`; 4.87 MiB host in `SHADOW_HOST_BYTES` (staging mirror included) |

## Sun clipmaps and lamp mips

- **A sun is a clipmap.** Level `L` has texels of `2^L` metres; its window is 64 × 64 pages around
  the camera (`sunLevelPages`), addressed by absolute page modulo the window, so a camera step keeps
  every page still inside. Sixteen levels (`sunLevels`) start at the near plane's pixel footprint.
  The depth range is the scene's box along the sun, snapped outward to its own power-of-two grid:
  every caster lies inside, and a small growth changes nothing. A page is read in the range it was
  drawn in — its word names one of the `SUN_DEPTH_RANGES` a sun keeps (`sunDepth.ts`) —, so a new
  range (a walker crossing a grid line) redraws no page its box does not cover; once nothing moves,
  older-range pages are redrawn in the current one, read meanwhile. The filter's taps keep to the
  home page, never reading a neighbour page of another range.
- **A lamp face is a mip chain**: 32 × 32 pages at its finest mip, down to one page. Six faces for a
  point, one for a spot.
- **The level is chosen per pixel, from its footprint** (the world distance between two adjacent
  pixels at its depth): a sun reads the level whose texel is at most that footprint, a lamp the mip
  whose texel at the point's distance is. A texel is never larger than a pixel where the map offers
  one, so a caster's error in texels is one in pixels. A page not readable yet hands the point to
  the next coarser level; beyond a sun's last level, the far-shadow ray against the resident proxy
  (`proxy.bin`) answers, deterministic and unaccumulated (`sun-far-shadow` publishes its bounds).
  The PCF taps each find their own page: a tap within a texel of a seam compares the four texels of
  its footprint in their own pages, weighted by hand — no seam, no guard band.

## Demand, mapping and drawing in one frame

- **Receivers mark the pages.** A compute pass after the light lists marks, per pixel, the pages the
  resolve will read, and the resolve records each page it reads — a bit per table word, tested
  before the atomic, and a list —, read back once per image like the texture feedback
  (`webgpu/shadow/demandPass.ts`, `pageRequests.ts`). Drawn clusters' boxes do not name pages
  (#1209): a ring round a lamp bounds the lamp's whole map.
- **The GPU maps what the frame marks, in that frame** (#1275). One workgroup reads the list — the
  plan's floors, claimed at its head before the demand so pixels never push one out, then the
  pixels' pages, deduplicated by the bitset — and maps each unmapped page from the free pages or the
  page least recently asked for, the finest first among equals, by the keys the host sorts by too
  (`pageKeys.ts`); a page this frame asks for is never evicted, and coarse levels are served first
  (`webgpu/shadow/allocWgsl.ts`). It frees the pages of a light gone and of a sun level whose window
  left them, and writes the table words, decoded by the shaders' shared page model
  (`pageModel.ts`). The host keeps the buffers and the grant; its pool follows the GPU's snapshot in
  each readback (`scene/light-shadow/mirror.ts`), and a word it sends is kept only for the page the
  GPU says its entry owns (`wordsWgsl.ts`). Blend and water surfaces read what the opaque pixels
  asked for and keep their early depth reject. Without the demand or allocation pipeline, the
  readback's report maps the pages on the host, frames later.
- **The GPU draws what it maps, in that frame** (#1275). The allocation lists every page it maps and
  those mapped before that no draw has filled; the host's words list every page whose depth they
  take (withdrawn on a light move, or overwritten for another entry). One workgroup composes the
  listed pages into regions, as many as the pair list holds every caster row of — the rest wait,
  unread, the reader on their floor (`webgpu/shadow/freshWgsl.ts`) —, each view composed from its
  light's record by the host's page view model (`pageViewModel.ts`: a lamp page is its face's clip
  cropped to it, a sun page its view cropped by the orthography), its cull volume a lamp page's cone
  or a sun page's box. The pair cull tests every caster row against every region
  (`freshCullWgsl.ts`): the rows are every resident page of every caster, whatever the camera or a
  light cut selected, so a caster the camera does not see still shades a receiver it sees; each kept
  row is one `(region, row)` pair, never past capacity. The seal makes each page readable; each pool
  layer's pass clears its pages and draws every pair in two indirect draws, casters placed on their
  page in the vertex stage and kept to it by the fragment, no viewport set (`freshPass.ts`,
  `freshDrawsWgsl.ts`); a tinted transmittance layer's pass does the same for blended casters. The
  host redraws a page with its light cut and static layer once a report names it, the GPU's draw
  readable meanwhile (`DRAWN_GPU`). So a page read first in a frame is drawn before anything samples
  it: no one-frame hole, whatever moves. A frame whose view, world and lights hold, whose host took
  no page's depth, after a snapshot that listed none, runs none of it: at rest it asks for the pages
  the frame before drew (`freshWanted`, `gpu.moved`).

## When a page is stale, withdrawn and drawn

**Every stale page the image reads is drawn in the frame that marks it** (#489): no per-frame page
cap, no millisecond budget. The list goes coarsest first, each light's floor leading (#525), an
order that matters only to a frame its memory guard stops. Cost is held by caching — a page is
redrawn only when what it holds changed —, never by showing a coarse or stale page as current. A
page is drawn with its own projection into its physical page (viewport and scissor), touching no
other.

The table word's valid bit says whether a page is read. A page whose depth is wrong is withdrawn
(`pool.withdraw`) until its redraw lands, the pixel reading the next coarser level; a page never
drawn is not read. A page holds two validities: its static depth, in the static layer, and its
moving depth, the moving casters drawn over it.

| Cause                                                                                                                                                        | Pages staled                                                                                                                                                                                                           | Read until redrawn?                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A light moves — kind, position, direction, range, cone, a rect's frame and size, emitter radius, whether it casts —, or a sun's clipmap moves its projection | every page it maps, floor included, redrawn whole at the new pose, shaded with the light's current matrices                                                                                                            | no: their depth is the old projection's                           |
| Intensity, colour or penumbra                                                                                                                                | none                                                                                                                                                                                                                   | —                                                                 |
| A still caster moves, is added, removed, hidden or shown, or its material, cutout texture or residency changes                                               | the mapped pages its projected boxes, where it was and where it lands — each apart, never the pages between —, cover, at the levels where the box holds a texel's sample; redrawn whole, static casters into the layer | no: their static layer is wrong                                   |
| An object already moving moves                                                                                                                               | the same boxes' pages; restored from the layer, moving casters drawn over                                                                                                                                              | yes: a static shadow never vanishes while something near it moves |
| A mover at rest; a camera move (the clipmap scrolls, only entering pages drawn)                                                                              | none                                                                                                                                                                                                                   | —                                                                 |
| A representation change: hidden or shown, casting toggled, alpha mode, cutout texture or pages' residency, a blended caster's coverage                       | its pages once the camera rests — a still object's redrawn whole, a moving object's moving casters alone (the layer never held them), the two in separate unions                                                       | yes                                                               |
| A cut-threshold change                                                                                                                                       | once the camera rests, the pages drawn at another threshold                                                                                                                                                            | yes                                                               |
| A stale page no report names                                                                                                                                 | —                                                                                                                                                                                                                      | no, since blend and water read without asking                     |

So no shadow stitches past poses or outlives its caster (`staticSurvives.test.ts`,
`moverPages.test.ts`). A box that holds no sample of a level's texels — a small caster under a
coarse level, lying between the depth texels' centres and the transmittance layer's, a sixteenth of
a texel of slack aside — writes no texel there before or after it moves: that level's pages keep
(`pageRects.ts`, `moverTexels.test.ts`, #1345). A residency flag that drops and rises within a frame (rows follow the table
epoch when a pose moves) is no change: only a flag differing from the last plan's restales its
cluster's pages (`webgpu/shadow/residence.ts`).

**The floor is always current.** Every page a report names asks for its light's floor too — a sun's
last clipmap level, a lamp face's one-page mip —: mapped first, never evicted while anything above
it is read, drawn in the frame it goes stale. It needs no report: a sun asks every frame for the
floor pages its view reaches, and a new, moved or reshaped lamp for each face's floor until a report
written at its current pose returns (a past pose's report names only the faces its receivers read).
So a pixel falling back past a withdrawn page reads a current floor.

**Batches.** The frame draws its pages in as many batches as the per-batch buffers take
(`shadowPagesPerBatch`, 24 pages, in the views one light cut runs at once), all in one command
buffer, each batch's writes landing in command order (`gpu/shadow/batchWrites.ts`,
`webgpu/pages/render/encodeShadowBatches.ts`). Their buffers are granted once
([Memory](#memory)): one layer, 4 096 pages, in full batches of 24 is at most 171 batches a frame
(`MAX_SHADOW_BATCHES`), 4 104 pages, each batch in at most 24 light views. A frame may draw the
current pool's pages in batches of the fewer of 24 and the views one batch runs
(`shadowBatchCapacity`), at most 171 and at most what the device's `maxBufferSize` stages — 109
batches for the 2 601-page pool at 720p, 38 where buffers stop at 1 MiB. A bound, never a command: a
frame encodes only the batches its pages fill, and a face with no casters encodes no cull pass. The
shaders' arrays, strides and uniform layouts — light-cut views, region faces and commands,
occlusion slots — are generated from those constants (`recordPack.ts`, `batchBudget.ts`), never a
literal twin (`gpu/shadow/capacities.test.ts`).

A list past capacity — a pool of more than 4 104 pages all stale at once, or a light cut that
dropped work and cut its batches short — draws its capacity and leaves the rest pending, a declared
limit counted in `shadowPagesPending` (otherwise 0 unless a batch could not be encoded). Pending
pages go stale-longest first, so pages re-marked every frame cannot starve the others: a page that
stays read is drawn within ⌈pool pages / batches⌉ + 1 frames, 34 at worst (`admit.ts`). A report
naming more pages than the pool holds (`shadowRequestCap`) maps the coarsest, then by table entry,
never in the GPU's append order; the rest read coarser, waiting for nothing, counted in
`shadowPagesOverflow`. A still scene runs no resolve and asks for nothing; the image holds once a
report proves it reads only drawn pages.

## The static layer: moving objects redraw their own casters

A placement turns moving the first time its pose or its row's flag actually changes
(`webgpu/shadow/mobility.ts`) — a pose rewritten where it stands, or a row inside a written range,
is no move — and stays so. From then on the pool keeps a static layer, a second depth texture the
pool's size, allocated at that first move: a scene where nothing moves pays neither its bytes nor
its pass. A page drawn in full writes its static casters into the layer, restores itself from it and
draws its moving casters over; a page only a mover crossed is restored and gets its moving casters
alone, split by one word per row in the page cull. A mover never goes back into the layer (#993):
staying moving costs its casters only in the pages another mover makes the frame redraw, while
rejoining would cost two layer redraws per pause, static casters included, and a rest timer would be
a scene-tuned constant; revisit only if falling boxes and a walker or car at 1728×1117 CSS, DPR 2,
show a net gain beyond run spread, transition frames included.

Every shadow pipeline — static layer, light-cut row map, page pyramids (the camera's Hi-Z kernels),
occlusion test and, if blended surfaces cast, transmittance draws — is compiled at prepare, in its
own step (`shadow pipelines`, `webgpu/pages/prepare/lights.ts`), except the draws of a blended
caster prepare did not see, compiled at its first frame.

On a code-built scene with one ball moving over a static ground, 1280×720, 4.4 pages a frame are
redrawn (6 at most) with one light cut, against 224 pages on `develop`, and the frame after
the motion is 0 px from a fresh render of the same pose.

**Measured.** The layer costs the pool's bytes again and one restore draw per redrawn page. Paired
A/B runs of `develop` by the acceptance session (Apple M2 Max, headless Chrome, 1728×1117 CSS at
DPR 2, bodies moving: car driven, walker walking, loaded machine); a batch holds other merges, so a
row is a batch's cost. Posted 28 Sept. 20:02 UTC as `measure ok` on #989 and #990, median GPU ms of
five interleaved pairs, load 15–75, batch `884cde8b5` → `e36d93ea1` (capacity change #1045,
static-survival change #1064):

| Example (GPU p50 ms) | before | after | paired difference            |
| -------------------- | ------ | ----- | ---------------------------- |
| falling-boxes        | 28.1   | 25.4  | −1.0 to −3.2 (5/5 faster)    |
| spin-an-astrolabe    | 30.7   | 28.3  | −1.4 to −4.2 (5/5 faster)    |
| drive-a-car          | 25.8   | 26.4  | −1.0 to +1.7                 |
| a-walker-among-balls | 59.2   | 60.2  | −0.8 to +2.4 (one +44 spike) |

CPU frame 1.4–2.3 ms both sides; every scene under 60 fps on the GPU (25–60 ms), so on 28 Sept. the
120 fps target (#525) was not met. The no-demotion decision (#993, #1146): batch `3e58f044f` →
`d5ec49069`, six pairs, load 25–60, posted on #993 on 28 Sept. 22:35 UTC — GPU p50 +0.13 ms
(falling boxes), +0.24 (walker), −0.59 (car), +0.53 (astrolabe rotating), all within run spread
(widest −1.5 to +2.0 ms), CPU p50 within 0.07 ms: no regression or gain resolved; resize and
pause/resume not run. The astrolabe is the counterexample: every caster of its pages moves, so the
layer restores almost nothing; a cache percentage is no measure of it. Physical pages are memory,
not frame time: the pool past one layer (#818) left the falling boxes' GPU envelope unchanged and
raised their peak memory by 118 MB (1 410 against 1 292 MB, #850's baseline; the walker 1 465, the
car 1 417), its layer doubling with it until the runtime resize repays it. Later batches post their
numbers on the issues they measure.

## Casters: the light cut

The pages of one light view — a sun level, a lamp face at one mip — form a run, and every run of the
frame is selected by ONE traversal of the cluster cut: the camera's kernels, pipelines, clusters and
residency bits, with flags, counters and output of its own (`gpu/dag/lightCut.ts`). Each work item
(queued node, candidate page, live cluster) carries its view's index; each view has its own uniform
block and per-primitive frustum planes, nothing carries over between frames, and the frame pays the
waits between dispatches once, not per view. Each view's clusters land in their own range of one
log, which the light compaction walks view by view. The budget is fixed: lists and queues are the
camera cut's size whatever the view count (at most `shadowPagesPerBatch` views, and what the
device's dispatch and binding limits hold, `gpu/dag/lightCutCapacity.ts`); work past them is
dropped, the batch's pages drawn again, and the views per batch bisected between the most a batch
drew whole and the fewest one dropped with — a bound on a batch, never on the frame
(`shadowBatchCapacity`).

A run's window is the square bounding its pages, cut in eight by eight cells of whole pages; a node
or cluster covering no cell a drawn page lies in is dropped. Error is counted in the view's texels
against the camera's pixel threshold, and the normal cone is off, since the shadow raster culls no
face. The light's mask is compacted over the camera's draw items, and each page culls that list
against its own box or cone. A caster the pool lacks is drawn through its nearest resident ancestor,
by the camera's cut rule ([RESIDENCY.md](RESIDENCY.md#one-cut-rule-per-cluster)), with every page of
that view: those pages alone are redrawn once residency changes. A batch whose requests were not
read — no report readback free, or its list full — redraws them at once
(`gpu/dag/lightCutRedraws.ts`, `light-cut-redraw`). A page is redrawn as it was drawn: a restored
one redraws its moving casters alone over the kept layer.

Every batch's cut appends its requests to one list (`VIEW_APPEND`), copied once after the last batch
into one of two report slots (`gpu/dag/lightCutReports.ts`), so every batch's missing casters are
asked for. Each frame's flag words ride in one slot sized for the most batches, eight made at
creation (`SHADOW_FLAG_FRAMES`); a frame finding all eight still read draws no light-cut page, its
pages staying stale and read, drawn by the next frame with a slot, never withdrawn on a guess
(#1142). Light-cut requests are a second residency tier, loaded after the camera's pages into free
slots, never pinned. The CPU cut does the same, reading the run's view as a camera
(`webgpu/shadow/cpuCasters.ts`); its casters take rows behind its own (#10, #26). A view whose CPU
list is empty marks its regions casterless: the page is still cleared or restored, with no bind
group and no draw (`regions.casterless`, #1210).

## Depth draws

The depth's fragment stage writes nothing and only discards a cutout's hole or the emitter envelope;
an opaque caster runs none unless its face carries an emitter envelope. The page cull files each region's casters in two lists of
its slot (`KEPT_LISTS_WGSL`, `gpu/shadow/cullShader.ts`) by the cutout bit of the row's mobility
word (`MOBILITY_CUTOUT`, set from the row's `FLAG_MASK` in `webgpu/shadow/bounds.ts`): opaque ones
from the start, counted by the region's first command, cutout ones from the end down, counted by its
second. The opaque list is drawn by `shadow_depth_vs` with no fragment stage (early depth, no
fragment invocation), or by `shadow_vs` with the fragment when the face carries an emitter envelope;
the cutout list by `shadow_cutout_vs` with the fragment, only while some row is a cutout
(`hasCutouts`). The three pipelines (`gpu/shadow/depthDraws.ts`) compile at the `shadow pipelines`
step and place a corner through one `shadowVertex`, whose position is `@invariant`; a texel keeps
the nearest depth whatever the draw order, so the page is develop's single draw to the bit, which
`gpu/shadow/depthSplit.test.ts` checks against develop's corner on random casters and on NaN, ±0,
±Inf, empty and full-slot inputs (the audit's OMB-01 harness, #965). The transmittance layer draws
the first list alone, which holds the blended casters.

Masked cut-outs are read at the mip the reading texel's footprint selects, in the visibility raster
and the shadow pass alike, and the material resolution requests the tiles of the sun level each
masked pixel's footprint reads. A colour tile's arrival invalidates the shadow pages of the masked
surfaces that read its texture, and those alone. Known limit: a caster the camera never sees has no
one to request its tiles; the shadow pass then reads the finest tile resident.

## Blended casters: the transmittance layer

A blended surface casts only with `transparentShadow: true`
([SDK.md](SDK.md#a-see-through-surface-casts-no-shadow-unless-it-asks); `castsBlendShadow`,
`gpu/shadow/transmittance.ts`); a cooked model's materials carry no such flag. A blended cluster is
drawn by the blend pass and never enters the visibility tables: to cast, it takes a row of the page
table _behind_ the visibility rows, read only by the shadow pass (`webgpu/row/blendCasters.ts`),
taken when its slot arrives and given back when it leaves; the pool bounds how many exist, and a
scene that blends nothing has none. The light cut finds it at that row (`gpu/draw/lightRows.ts`,
pinned by the host), the CPU cut lists it there, and the same cull draws it.

It never writes the pool's depth: it fills the **transmittance layer**, two textures at half the
pool's resolution (one texel per 2 × 2 depth texels, same pages and table, texel / 2): the
transmittance, `rgba8unorm`, whose RGB keeps `Π(1 − coverage)`, coverage being the material's
opacity times its colour map's alpha, and the nearest translucent depth, `depth32float`.
Transmittance is low-frequency; the same PCF filters it. Its own pass follows the pool's
(`webgpu/pages/render/encodeShadowPass.ts`): each page the pool drew is cleared to full
transmittance and far depth, then draws its list twice from one shader entry, only the blended rows
surviving — depth only, depth-tested, for the nearest depth; then colour only, blended
multiplicatively, without depth —, both discarding a fragment the opaque depth hides at all four of
its texels. Once the last blended caster gives its row back, the layer stays and its pages are only
cleared.

The shadow read multiplies its filtered PCF result by the layer once, at the footprint's centre
(`lighting/direct/shadowWgsl.ts`), since the sixteen taps lie within one texel of it: the four
texels around it, kept within its page, each its transmittance where the receiver lies behind its
translucent depth, filtered bilinearly. A pixel the opaque depth fully darkens reads nothing of it.
A constant opacity gives a constant shadow, two panes multiply, a receiver in front of a pane keeps
its light, and a receiver 2 m behind a pane at a 4 km sun range is attenuated: the depth is single
precision. Blended rows count as moving, so the static layer keeps depth alone and a restored page
starts from full transmittance. The layer exists from the first blended caster on, 8 bytes per 4
page texels (`shadowTransmittanceBytes`, in `SHADOW_POOL_BYTES`); before, the passes and read are an
opaque scene's, binding one-texel stand-ins never sampled. Limits: one nearest depth per texel, so a
receiver between two stacked panes takes both; each product kept in 8 bits; opacity 0 takes no row,
opacity 1 lets no light through. Additive and transmissive surfaces cast nothing yet: the tinted
shadow of transmission is #33's, colouring the same RGB layer. An unpaged blended mesh casts
nothing.

## Metrics

| Metric                                                                                                   | Meaning                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shadowPagesRequested`, `shadowPagesCached`, `shadowPoolPages`, `shadowPagesDrawn`, `shadowPagesPending` | the frame's page work                                                                                                                                          |
| `shadowWaitMs`, `shadowWaitFrames` (direct-lighting diagnostic only)                                     | wait of the oldest stale page the image reads, while a report names it (#489)                                                                                  |
| `shadowPagesRestored` / `shadowPagesRasterized`, `shadowRestoreCopies`                                   | pages restored from the static layer, moving casters alone rasterised / pages whose static casters were redrawn (#991, counted on the host, never in a shader) |
| `shadowStaticDrawCalls` / `shadowMovingDrawCalls`, `shadowMovingCastersKept`                             | draw calls by caster kind; sampled clusters' moving casters kept                                                                                               |
| `shadowBatches`, `shadowLayersDrawn`                                                                     | batches and pool layers drawn                                                                                                                                  |
| `shadowPagesStaledBy`                                                                                    | pages staled by reason: light, still caster, moving casters, detail, cut threshold, depth range                                                                |
| `shadowPoolBytes`, `shadowPeakBytes`                                                                     | allocated and peak bytes                                                                                                                                       |
| `diagnostic.shadowAtlas(world)`                                                                          | the pool's raw depth hash                                                                                                                                      |

## WebGL2 has none

WebGL2 has no shadow path, neither shadow atlas nor virtual pages: its lights reach every surface
(`webgl/cluster/lights.ts`). `CONTRACT_LIGHTS_LIGHTING` publishes `shadows: false`, and the lights
of the set that lights (the contract's, else the source graph's) that ask to cast are handed to
`ContractShadows` at each change of that set. The world, or a session opened without one, names each
as `shadows-refused` (`noticeShadowRefusal`).
