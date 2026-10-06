# Residency

What stays in memory: the geometry pool, the cut that reads it, and the virtual textures. The
budgets a page sets are [SDK.md](SDK.md#memory-budgets); the raster that draws the cut is
[ENGINE.md](ENGINE.md#webgpu-page-raster); the shadow page pool is [SHADOWS.md](SHADOWS.md).

## One cut rule per cluster

`page/cut/rule.ts`, #486. A cluster is drawn when it is resident, its parent group is coarser than
the threshold, and either its own error meets the threshold or the group finer than it is not
resident:

`draw(c) = resident(c) && parentError(c) > t && (clusterError(c) <= t || !resident(childGroup(c)))`

The kernel compiles the same expression (`dagMask`) as its CPU model (`gpu/dag/oracle/oracle.fixture.ts`);
the threshold is always the host's. Residency is read by group (`page/cut/readiness.ts`): a group is
resident when every cluster it replaces is, and so is every group above it (a cluster nothing
replaces stands for itself). A group then draws all its outputs or all its members, never both or
neither, so every surface is drawn exactly once, by the wanted cluster or **its nearest resident
ancestor**, and a missing page coarsens its own neighbourhood by one level, never its whole
primitive nor the root cover. Every fallback below — memory short, a page not yet uploaded, a
dependency that does not fit, a shadow caster the pool lacks — is this rule. The host derives both
bit sets from the pool's residency and uploads what changed (`gpu/dag/readiness.ts`).

Because a group needs all its members, the cut asks the cache for whole groups closed upward,
group-mates a view never keeps included (`page/cut/groupClosure.ts`); otherwise a group straddling
the frustum or the normal cone would stay one level coarse. Top-down pruning drops a subtree whose
error floor is above the threshold only when none of its clusters has a missing finer group, a count
each culling node carries (`NODE_OPEN`), so the nearest resident ancestor of a missing page is
always a candidate. No frame waits for coverage once the root cover is resident.

The CPU cut (`page/cut/take.ts`) applies the same predicate on the same readiness, kept per
placement in view and moved by the pool's residency feed — the rank journal on WebGPU, the page
store's loads and releases on WebGL2 —, so a still view reads no page and a change reads only the
pages that moved (`page/cut/held.ts`). It prunes on the same open counts, in JavaScript and in its
WebAssembly node walk (`page-codec-wasm/src/cut.rs`); the WebGPU CPU path, its light cuts and the
WebGL2 image draw through it, with no fallback of their own. No table is sized by the world: the
readiness holds the resident pages alone (every other page's state derives from the DAG), and the
closure, the cut's differences, the residency sets and the pending set hold what the cut names, in
sparse maps (`page/cut/sparseInts.ts`); a placement leaving the view drops its readiness at the end
of the image's cut. A world sixteen times larger, from the same view with the same pool, costs the
same bytes (`page/cut/viewBound.test.ts`).

## The geometry pool

The geometry pool holds `floor(bytes / pageBytes)` slots, the root cover held for the backend's
lifetime; the texture pool is split between the colour and data atlases in layers. The world's GPU
and CPU totals reach the pools through one fixed split (`residency/memoryBudget.ts`). When a view
asks beyond the pool, the WebGPU cut keeps the host's screen error: the pool loads what fits,
coarsest first, and the cut rule draws the rest. Residency does the coarsening, so a smaller budget
is paid in detail, one DAG level at a time from the finest; `coverage-budget` only says the image
asks for more than the slots hold.

**Minimum capacity** (#1237, `residency/minimumCapacity.ts`). Memory never forces a cut the view
refuses: the cook drops a part only at a level whose error covers it, so a root drawn where the view
refuses its error loses every smaller part (a column, a lintel). The pool's floor is the root cover
and the pages of the group each root replaces, one level finer, plus on WebGPU the vertex buffers
held beside the slots (`geometryBudgetBeside` in `webgpu/pages/io/memory.ts`, the rule the texture
pool follows for its live textures). A budget under it is raised to it by name (`root-cover`), its
cost published at open (`minimum-capacity`: `rootPages`, `floorPages`). Both engines admit those
pages before any other, whatever their level (`floorFirst`, `admissionLevel`), and the WebGPU CPU
cut ranks through the same admission: at the smallest budget a root the view refuses is replaced by
its group, one it accepts drawn as before.

**Pinned bytes** (#1237, `scene/worldRoots.ts`). The runtime pins one thing: the world top the cook
publishes (`world-roots.table`, [FORMAT.md](FORMAT.md#world-super-roots)), read as the model loads —
its bundles, the first of `world-roots.bin`, in one ranged read, each checked against its digest —
and held for the scene's life, bounded by the materials, never the world (the session's `world-top`
diagnostic: `pinnedBundles`, `pinnedBytes`, `heldBytes`). Object roots are pages held by the view:
a model not partitioned holds its placements for its life, a partition's placed cells hold theirs
until they leave, and each placed cell holds the world bundles past the top its objects' roots
depend on (`scene/partition/cellPages.ts`), each once, released with the last cell needing it. The
session counts those bytes in the CPU budget beside the engines' host tables. The super-roots are
not drawn yet: a cell's super-roots standing in for a far cell is #1238.

### WebGPU: slots, resizes and tables

The slots are what the budget leaves beside the vertex buffers, computed at prepare once those are
allocated and at every resize; slots and buffers never sum past the budget, save one raised to its
floor. A pool resize (`explorer.setMemoryBudgets`) copies pages and tiles on the GPU into the new
pool — root cover, then pinned pages, then the most recent —, evicts only what no longer fits, and
rebuilds every bind group naming the old pool on the next image. At prepare a pool is allocated
once, under an out-of-memory error scope; at a resize, where the old pool lives until the copy, the
new one is first probed under that scope (`webgpu/residency/poolGrants.ts`). A refusal halves the
pool's bytes and retries by the same rule, down to its floor, so the pool in place is never
replaced by an invalid one. The copy holds both pools at once (`transientBytes`), a peak the probe
has the device grant, beside the tables grown first, before any page moves.

The tables sized by drawable row start at `geometryPoolCeilingBytes` and grow in place when a larger
pool asks more rows (`webgpu/pages/prepare/growTables.ts`, #216): every GPU buffer sized by row is
made anew under one out-of-memory scope while the old ones still draw, and swapped in once all are
granted; each visibility row keeps its rank, no shader, pipeline, page or tile is remade, and
nothing sized by row is made after the swap (spheres, mobility words and tested-half work buffer
included). A refusal keeps pool and tables in place (`tables` in the report); a lost device grows
the CPU rows alone, and the rebuild makes its GPU tables at their size.

### WebGPU: admission and eviction

A region keeps a complete resident representation until every replacement page is uploaded. A page
enters the pool only after the pages it depends on, the clusters of the group that replaces it, read
from the compiled group links (`webgpu/residency/admission.ts`): loading a wanted page or a shadow
caster brings its missing dependencies first, each after its own, up to the pinned root cover. The
bytes come first: the host's request for a page lists the missing bundles its bundle depends on
(`streams.pages[].dependencies`, [FORMAT.md](FORMAT.md#cluster-dag)) and keeps them retained with
the cut, even with the parent outside it. The compiler refuses a list that misses a parent's bundle
or is not closed, so every page the pool walks has its bytes requested. Until they arrive, or when a
dependency does not fit, the page is not loaded. Both tiers of the residency queue — the camera's,
and the lower tier of the view ahead and the light cuts — share this path.

Loads on the GPU-cut path are read off the readback's requests, closed over their groups
(`webgpu/residency/requestAdmission.ts`, #836): past the pool, the coarsest levels whole and the one
the room straddles in part, what the queue already holds first, from the pool's room alone. The CPU
cut ranks by the same admission, off the pages its cut closes over (`closure.forEachHeld`, #974):
the GPU cut keeps no ranking of its own, and a CPU cut taking the image back ranks what it left.

**Eviction queue.** A resident GPU cut publishes on the same readback the order the cache gives
slots back in (`gpu/dag/evict.ts`, `gpu/dag/shader/evictWgsl.ts`): the pool's keys, finer level
first (a parent after its children), then oldest last use, its first `EVICTION_BURST`; the
readback's budget is two lists plus one burst, whatever the catalogue. Every placement stamps its
key's canonical page, so a key's stamp is its last use; a key the latest cut read is never listed.
The kernel sweeps the pool's list, one canonical page per held slot, fed by the cache's arrivals and
departures (`gpu/dag/poolList.ts`), never the catalogue. On the GPU-cut path the cache evicts only
from that queue, skipping pinned pages and taking a page a lower tier touched since the last queue
(a shadow caster) after every other; once spent (`eviction-queue-spent`) the burst waits for the
next readback. The CPU cut evicts the least recent page.

### WebGL2: the pool

The WebGL2 engine sizes its pool by the same rule (`sessionGeometryPool`: slots of the largest
decoded page, page cap and session ceiling), its ceiling a fixed bound. A slot holds one geometry
copy: a classic instance (`addInstance`) holds its own copy of every page, so a page three instances
draw fills three slots, while the records rows place share one. The cut is drawn on the CPU at the
host's threshold; the pool bounds what the image asks for, never the cut. The image asks for the
wanted cut closed over its groups (`page/cut/groupClosure.ts`), coarsest level first, so no page
comes before those it depends on (`backend/autonomous/requests.ts`). The pool admits that list in
order — the minimum capacity's pages first — while the copies fit its slots, the root cover held
beforehand (`backend/autonomous/pool.ts`); the rest is not asked for.

What stays resident is the engine's one residency, fed as WebGPU feeds it (`residency/lastUse.ts`):
what the image asks for and draws is held, each holding the pages it depends on
(`page/selection/pageParents.ts`), so the ancestor a surface falls back to never leaves under it. Just
before a cut, what the last image drew but no longer asks for lets go, one DAG level per image,
finest first; a page let go is released at the next cut, or at once when the pool is short by that
many slots, as WebGPU's window gives way under pressure (`backend/autonomous/poolOrder.ts`).
Released pages leave oldest first (`evictOldest`), and the residency's keys follow what is held,
never every page once asked for (`backend/autonomous/pageKeys.ts`). Between two cuts, what the image
drew and every page arrived since stay: no hole, and no page evicted on arrival. Only the root cover
and the pages the host replaced (`replaceGeometryPage`) stay above the slots, counted as the pages'
bytes are, every geometry copy included. No pool is reserved: `geometryPoolAllocatedBytes` is
`null`, and what the pages hold is `geometryAllocationBytes`. Backends without pools throw
`UNSUPPORTED_MEMORY_BUDGETS`. `coverageBudgetLimited` says the wanted cut did not fit; a verdict
change is queued and published as `coverage-budget` by `flush`, as on WebGPU, with `requiredSlots`
the slots the whole request charges and `pixelError` the host's threshold.

A composed WebGL2 capture draws in a view of its own (`backend/autonomous/views.ts`), as WebGPU's
does: each view holds its cut, requests, motion and size, and one switch trades their references
(never run with one view). The views share the page store and the pool, which admits the drawn
view's requests after the other views', each page charged once: the union stays under the one
budget. The residency holds the union and the streamer pins it, the main view's requests first; a
released view's pages leave it. The main view keeps its cut and motion across a capture.

**What WebGL2 declares it cannot carry.** WebGL2 keeps the cut rule, the residency and the budget;
what it lacks it names in `capabilities.unsupported` and in the `render-capabilities` diagnostic it
publishes on opening (`backend/autonomous/capabilities.ts`), never silently: no GPU-driven selection
or indirect draw (the cut runs on the CPU), no occlusion culling, no cast shadows
([SHADOWS.md](SHADOWS.md#webgl2-has-none)), no global illumination, no temporal antialiasing, no
physical VRAM reading. Each costs work or a feature, never coverage: no hole and no stale image.

## Out of memory

The public contract — refusal codes, the `gpu-out-of-memory` diagnostic, what the page sees — is
[SDK.md](SDK.md#out-of-memory-is-absorbed); the shadow pool's events are
[SHADOWS.md](SHADOWS.md#memory).

**WebGPU at prepare.** No pool is in place to keep, so a floor the device refuses is refused by
name, never allocated at the full request outside the check:

- `WEBGPU_GEOMETRY_POOL_REFUSED`, the root cover: the WebGPU backend's preparation fails
  (`backend-preparation-error`); the world goes on with its other backends (a `fallback` event,
  `WEBGPU_UNAVAILABLE`), and a world drawing straight to a GPU canvas rejects with the code.
- `WEBGPU_TEXTURE_POOL_REFUSED`, the texture pool's floor: the material pipeline drops
  (`material-pipeline-failed`, the code in `context.error`) and the pages draw with the fallback
  pass; a GPU canvas, which needs that pipeline, fails preparation with
  `WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE`. The fallback pass draws every transparent blending mode
  with the surface's alpha, cluster by cluster, and refuses by name a transparent line it cannot
  widen (`FALLBACK_TRANSPARENT_LINES_UNSUPPORTED`) and a frame the GPU cut selected, which leaves
  it no cluster list (`FALLBACK_BLEND_WITHOUT_CPU_CUT`).

**WebGPU frame targets.** They follow the requested resolution and are admitted before allocation
through the GPU total (`gpuFrameTargetBytes`, their descriptor bytes); the device ledger also checks
later buffer and texture allocations, shared caches included, before calling WebGPU. This bounds
declared resource bytes, not unobservable driver overhead. The targets are made under the pools'
out-of-memory check, at prepare and when the view's size changes, the frames held meanwhile with
nothing presented. Refused, Hi-Z goes first, for the rest of the session: its absence costs time,
never image (`gpu-out-of-memory`, `pool: 'frame-targets'`, `dropped: 'hi-z'`). Refused even then,
the visibility targets included, they are refused by name and the mode kept, never a lost device
(`frame-targets-refused`); they are asked again only when the view's size changes, or by a capture.
Once the targets are in place, a live allocation that moves the ledger funds the pools again beside
the frames, one funding at a time, and never holds one: a funding refused keeps the pools in place
and is said once (`frame-targets-refused`, `reason: 'budget'`), the frames going on (#1362). A
target grant and a capture wait for a funding in flight, so two never move the pools at once.

**WebGL2.** It has no out-of-memory scope, so the engine reads `gl.getError()` for its allocations
— a buffer, a texture level, a target sized again, never an upload in place — without holding a
frame: `getError` waits for the GPU process, so each allocation is recorded with its pool, each
frame's end fences what it allocated, and the errors are read before a later frame's first command
once the oldest fence is passed (a fence is kept until the GPU passes it, however far behind). An
`OUT_OF_MEMORY` marks the pools of every allocation not yet confirmed, each made again at its next
use, and the next frame answers each pool as WebGPU's refusal does (`gpu-out-of-memory`, the pool
named): `geometry` halves the geometry pool, the residency letting the finest pages go one DAG level
per image; `texture`, a map, is sent again at its next bind — no surface is drawn without its
picture, and there is no coarser one —; `target`, a frame target or the frame's light data, is
sized again at its next draw, nothing to halve. The pages' vertices and indices share one set of
buffers per vertex layout, made again larger when full with every page laid out again; a growth the
context refuses gives that set up, its pages placed in a new one. A browser that answers by losing
the context takes the context-loss path (`webglcontextlost`, then `webglcontextrestored`): nothing
is drawn while it is lost.

WebGL2 uploads every declared surface's maps ahead of the draws, within `texturePoolBytes`: the
session's preparation sends them, then each frame what is left, only once the GPU ran the step
before, and only the maps that fit what is left of `maxTextureTransferBytesPerFrame` (16 MiB) and
`maxTextureUploadMsPerFrame` (1 ms) — one larger than the whole budget alone. A map not sent yet is
uploaded by the first draw that binds it.

## Coverage counters

Shared URLs occupy one slot across instances. Two counters say different things:

| Field            | Meaning                                                                                         | Reported by          |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------------------- |
| `pagesDetached`  | clusters that left the drawn cut since the backend was created: cut churn, not memory pressure  | the WebGL page paths |
| `cacheEvictions` | pages actually evicted from the cache that feeds the drawn geometry: the memory-pressure signal | every backend        |

`coverageReady`, `coverageBudgetLimited` and `streamingError` report coverage; the `coverage-*`
diagnostics trace bootstrap, budget, upload and streaming failures. A failed URL is retried at most
three times per session; an initial cover read failure rejects preparation.

On WebGL2, `uncoveredTriangles` counts the holes of the image's cut (`page/cut/take.ts`): triangles
of root-cover clusters in view the cut rule would draw but that are not resident, nothing coarser
standing in. Zero is the only healthy value: once `prepare` holds the root cover, a non-zero reading
means that floor broke. WebGPU reads `null` by design: its cuts draw what they select, so the
no-hole proof is on the drawn set. WebGL2 also publishes `drawnTriangles`
(`bench/runner/README.md`).

## Virtual textures

Every material texture is cut into 128×128 tiles (plus a 4-texel border) living in two fixed pools
(sRGB colour, linear data); one page table per texture says which pool tile serves each tile of
each mip level, and only the tiles the image reads are resident. The texture pool (512 MiB by
default, split evenly, in layers of 30×30 tiles) is the session's texture memory whatever the
scene, its layers allocated on first use: an atlas with no map holds none, its white fill (what a
material without a map reads) read from an opaque-white stand-in, until its first map opens the
lane's pool (#1345). The material resolution counts, for one pixel in sixteen (every pixel during `flush()`), the
tile each map needs at the mip its derivatives select; transparents write their requests into their
own target, reduced by a compute pass. The counters come back one frame late.

Uploads are bounded twice per frame, `maxTextureTransferBytesPerFrame` (16 MiB) and
`maxTextureUploadMsPerFrame` (1.0 ms), most-requested tiles first; the rest waits on its coarser
resident level, so a cold traversal streams at a fixed cadence instead of stalling. The first tile
of a pass is always copied. `textureUploadPeakMs`, `textureUploadMs` and `textureTilesDeferred`
publish the work; a stutter is read on the peak and the p95, never the median. A full pool evicts
the least recently read tile; a tile nothing can accommodate is counted in `textureTilesRefused`. A
missing tile is served by its finest resident ancestor, down to the texture's tail (every level of
64 texels or less, pinned at `prepare()`): never a fill texel. `flush()` renders the pose until
nothing it reads is missing, drains the pending shadow pages, and replays the temporal accumulation
identically, so a flushed pose is deterministic (`pose-settle` diagnostic).

**The engine reads the levels the compiler baked.** Once the cache declares texture chains, each
baked level is read on demand (decoded by the browser, held within `world.budget.cpu`, kept across a
device loss) and tiles are cut from it; a chain is generated at run time only for a texture the
cache carries none for. `textureSource` (`'cache'` by default) says whether the prepared scene reads
the source images: under `'cache'` an image whose chain the cache carries is never fetched, honoured
only where every mounted backend reads the baked levels; `backend-choice` publishes what was
settled.

**Block-compressed lanes.** Each atlas is one pool per lane: `lossless` (RGBA8), `rgba` (BC7 or
ASTC 4×4) and `two-channel` (BC5 or ASTC luminance-alpha — a normal map's X and Y, Z rebuilt).
`textureCompression` (`'auto'` by default, `'bc7'`, `'astc'`, `'none'`) names the family sampled:
`'auto'` takes the first family the device samples and the cache holds kept chains in, RGBA8 when
none. A texture takes the lane its chain was **kept** in by the compiler's quality gate
([FORMAT.md](FORMAT.md#textures)); a chain left lossless, a partial chain or a host image reads from
the lossless lane, so the engine never trades a pixel for memory on its own. Every lane with
textures gets one layer, the rest of the budget by the bytes its tiles would take.
`texturePoolFormat`, `texturePoolLayers` and `texturePoolBytes` publish the result, and
`material-textures-ready` lists each pool and each atlas's page table. A texture an atlas takes
after open grows its lane only by the layers its tail needs, under the texture budget: past it, or
past the device's layers, it is refused by `TEXTURE_BUDGET` and nothing drawn is evicted. Its page
table is regrown by copy into a buffer of its new size; `material-texture-appended` publishes the
catalogue, the page tables and the pool bytes.
