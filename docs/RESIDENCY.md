# Residency

What stays in memory: the geometry pool, the cut that reads it, the virtual textures. A map: each
mechanism's rule is stated where it lives, and this page names the file and the rules that span
files. Paths are under `packages/sdk-browser/src/`. The budgets a host sets are
[SDK.md](sdk/memory-budgets.md#memory-budgets); the raster that draws the cut is
[ENGINE.md](engine/webgpu-page-raster.md#webgpu-page-raster); the shadow page pool is [SHADOWS.md](SHADOWS.md).

## One cut rule per cluster

| Mechanism                                       | Where                                                      |
| ----------------------------------------------- | ---------------------------------------------------------- |
| The predicate that draws or withholds a cluster | `geometry/cut/rule.ts:drawsCluster`                            |
| Its residency, by group and closed upward       | `geometry/cut/readiness.ts`                                    |
| The GPU kernel's copy and its CPU model         | `geometry/dag/readiness.ts`, `geometry/dag/oracle/oracle.fixture.ts` |
| Whole groups asked of the cache                 | `geometry/cut/groupClosure.ts`                                 |
| The CPU cut, the kernel's oracle in the tests   | `geometry/cut/take.fixture.ts`, `geometry/cut/held.fixture.ts`     |

- One predicate on one readiness, the threshold always the host's. The GPU cut is the engine's one
  cut, every view's (`geometry/dag/aside.ts`): the CPU cut is the kernel's reference in the tests alone.
  Views share the cut's tables and cut again each image, each into its own list of visible
  clusters (`geometry/dag/aside.ts`): no mask is saved or restored between views.
- A missing page falls back to its nearest resident ancestor and coarsens its own neighbourhood by
  one level, never its primitive nor the root cover. Memory short, a page not uploaded yet, a
  dependency that does not fit and a shadow caster the pool lacks all fall back this way.
- Pruning drops a subtree only when none of its clusters has a missing finer group (`NODE_OPEN`),
  so that ancestor is always a candidate. No frame waits for coverage once the root cover is
  resident.
- The cut's state follows the view and the pool, never the catalogue
  (`geometry/cut/viewBound.test.ts`).

## The geometry pool

| Mechanism                                               | Where                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| The fixed split of the world's GPU and CPU totals       | `memory/memoryBudget.ts`, `memory/pools.ts`                 |
| The root cover, held beside the streamed pages          | `frame/prepare/rootCover.ts`, `geometry/residency/coverHolders.ts` |
| WebGPU slots, a streaming page each, and a resize       | `src/frame/io/memory.ts`, `pages/pool/resize.ts`, `src/frame/render/visibleTables.ts` |
| The world HLOD's table, DAG and held bundles            | `hlod/worldRoots.ts`, `hlod/worldBundles.ts`                    |
| The world HLOD actors the cut draws                     | `hlod/worldHlod.ts`, `dag/worlds/worldFollow.ts`                    |
| Eviction by least recent use, never a page depended on  | `geometry/residency/streamedPages.ts`, `geometry/residency/queue.ts` |

- The pool's unit is the STREAMING PAGE: a compiled page of 128 KiB resident and 256 clusters at
  most ([FORMAT.md](format/clustersjson.md#cluster-dag)), a run-time cut's page alone where the cache gives none
  (`geometry/rows/page/pageSlots.ts:pageUnit`, `geometry/residency/pageUnits.ts`). One slot holds
  one, its clusters packed at their offsets in it, never one a slot (`pages/pool/placement.ts`).
  The pool holds the root pages apart: its slots are the streaming pages `geometryPoolBytes` holds,
  each slot the widest streaming page, then its ROOT REGION of grains, each as wide as the widest
  root page — a compiled root page's 32 KiB at most (`pages/pool/placement.ts`, `RootSlots`). A
  ROOT PAGE — the root cover's, or an HLOD cell's while its actor is loaded — takes a free grain,
  never a streaming slot nor a victim's, and gives it back when its cell lets it go
  (`residency/pinUpdater.ts`). The region opens at 2048 grains (`DEFAULT_INITIAL_ROOT_PAGES`)
  within the catalogue's root pages, the root cover's at least (`frame/prepare/rootCover.ts`,
  `rootRegionOf`), and grows while the scene runs when the cells hold more: to the grains asked
  rounded up to two significant bits, within every root page the catalogue has
  (`frame/io/memory.ts`, `growWebgpuRootRegion`).
  `geometryPoolBytes` (512 MiB by default) counts the streaming slots alone, nothing else taken
  from it; a budget that holds none of them says so by name (`root-cover`), the root cover still
  whole.
- A page lands in its slot INSTALLED: the pool stages the bytes of the page on disk
  ([FORMAT.md](format/pages.md#pages)) and compute passes transcode them into the resident page at the
  page's offset in its streaming page's place — the pages that land together in one batch, run at
  the end of the microtask turn that staged the first: a first pass, a workgroup a page, unpacks
  the strips and writes every vertex the page stores; a second, a level of pages a dispatch, copies
  the vertices a page names from the clusters that hold them, each level after the staged pages of
  the streaming pages its pages name vertices of, whose resident pages the pool holds at the starts the
  loads gave (`dependencies`: one page of each streaming page of the closed list the page's bundle
  carries, installed before it; `geometry/residency/queueInstalls.ts`;
  `geometry/pages/install/installer.ts`, `transcodeWgsl.ts`; `pages/pool/commit.ts`). The place a
  page takes is the bytes it takes resident (`geometry.residentBytes`), not the bytes it was read
  as; a page a pass finds wider than its room is left unwritten (its version word zeroed), and the source's gate refuses
  one the manifest does not size (`frame/backend/readPage.ts`). A page that is no geometry page — a
  voxel brick, an index page — is written as it is.
- Past the pool, the cut keeps the host's screen error: the pool holds what the views asked for
  most recently, and the cut rule draws the rest by its resident parents (`coverage-budget`).
  Memory never forces a cut the view refuses; the pool's pressure scales the screen error alone
  (`geometry/residency/poolPressure.ts`).
- The runtime pins the world top alone; object roots are pages the view holds. The session counts
  those bytes in its CPU budget.
- A resize copies what fits on the GPU and keeps the image complete; a refusal keeps the pool.

### WebGPU: streaming and eviction

| Mechanism                                                 | Where                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| The pages each view asks for, a request a leaf, at the GPU's priorities | `dag/request/request.ts`, `gpu/core/selection.ts`                |
| The readout's size, followed between two frames           | `dag/lists/requestSize.ts`, `dag/queueGrowth.ts`                            |
| The requests and what they depend on, one higher a streaming page | `geometry/residency/pageRequests.ts`, `geometry/cut/groupClosure.ts` |
| The update: new pages, victims, installs                  | `geometry/residency/queue.ts`                                               |
| The use order of the streamed pages and their dependents  | `geometry/residency/streamedPages.ts`                                       |
| The quality under the pool's pressure                     | `geometry/residency/poolPressure.ts`, `frame/render/gpuCut.ts`              |
| The streaming's nine settings                             | `packages/sdk-core/src/contracts/streamingOptions.ts`                       |
| The engine's frames, which pace the installs              | `geometry/integration/frameBudget.ts` (`createFrameGate`)                   |
| The clusters' records, written when their pages are in the pool | `geometry/clusters/clusterResidency.ts`, `geometry/clusters/infoWrite.ts` |
| The list of visible clusters, grown by the readback's peak | `geometry/dag/visible/visibleGrowth.ts`, `geometry/dag/visible/layout.ts` |
| The cache's one hold: the root cover's pins               | `geometry/residency/pinUpdater.ts`, `pages/pool/eviction.ts`                |

- Every count below counts streaming pages: requests, pending, installs, the use order, its
  victims and the pool's pressure (`geometry/residency/queue.ts`, `queueStarts.ts`,
  `queueInstalls.ts`).
- A view asks for a LEAF of the culling tree — the clusters of one group, consecutive packed pages
  that may lie in more than one streaming page — in one request of three words: its first page, how
  many pages it names from there and its priority; every page of the range is asked. The readout
  holds one request a leaf, and its two lists as many ranks as the cut asks of it: it starts at
  `streamingMinRequests` (65 536) ranks, grows to a quarter over what a readback asked of it when
  two in a row asked more than it holds, and gives a fiftieth back at each readback after thirty
  under half of it, never over `streamingMaxRequests` (1 048 576) — both
  from 4 096 to 1 048 576 —, made again between two frames and never in a frame's critical path
  (`dag/lists/requestSize.ts`, `dag/queueGrowth.ts`). A cut past it is read by its head, its drawn
  clusters taken whole from the list of visible clusters.
- One update a frame, its requests read again whenever a view's readback is new, the capture's
  first. The requests are the streaming pages of the leaves every view asks for, each at the
  highest priority any view gives one of its pages, and of the pages they depend on, each at one
  more than the highest of its dependents — one per hop from streaming page to streaming page,
  however many groups a page holds, and theirs in turn as long as a priority rises
  ([FORMAT.md](format/clustersjson.md#cluster-dag)). The requested ones already started or resident move to
  the end of the use order, the views' own first, in their order. A caller may ask pages of its
  own at a priority it gives, kept as it is up to 0xffffffe0, the highest of the GPU's requests, and
  none at 0 (`prefetch`, the residency queue's third argument); left out, the pages are asked ahead
  of every view's request, the nearer the deadline the higher.
- The unique requests, as a percent of the streaming pool's slots, scale the cut's screen error:
  over `streamingQualityMaxPoolPercent` (85) two updates running, the scale falls by 3 % an update,
  down to `streamingQualityMinScale` (0.3); under `streamingQualityMinPoolPercent` (70) thirty
  updates running, it rises by 1 % an update, up to 1. The GPU cut divides its pixel threshold by
  it.
- The new streaming pages — requested, neither started nor resident — are started highest priority
  first, at most `streamingMaxPendingPages` (128) less those pending, every page of each read by one
  read of it. Each takes a free slot, else the slot of the first streaming page of the use order
  this update does not request, that has landed, holds no root cover page and that no started or
  resident one depends on — every page of it leaves as the arrival is written —; none left, the
  update starts no more. There is no other clock and no other ranking: a streaming page past the
  pool waits for a later update to free a slot.
- The started streaming pages are installed in the order started, each once its pages' bytes are
  in — none passes one still waiting —, at most `streamingMaxInstallsPerFrame` (128, never more
  than may be pending) a frame, and no time budget: a page costs its frame what it costs. A started
  streaming page whose object was made invalid while its bytes came — another page of it was given
  up — is dropped when it arrives, never installed, and never started again. One whose bytes fail
  for good is never started again by the session (below).
- A read that fails, whatever the failure — a network error, a 5xx, a 404 —, is asked again at
  once, with no timer and no wait: it is queued again behind the transfer that just ended, so the
  next turn of the queue takes it, as many times as `streamingNumRetries` allows (3 by default; a
  negative value without end). The first failure and the give-up are each said once, the first a
  warning that the read is being asked again, the give-up the failure; after the give-up the object
  the page belongs to is invalid and no more of its pages are read. The only wait is the one the
  server asks (`Retry-After`, ten seconds at most). The baked texture
  levels follow the same policy and the same count: a level that fails is asked again by the next
  frame that wants its tile, `streamingNumRetries` times, after the `Retry-After` wait where the
  server asked one; past the last it is given up, its tile stays on its coarse level and no request
  is sent for it again. The first failure of a row and the give-up are said
  (`geometry/streaming/failures.ts`).

  ```ts
  const world = createWorld(canvas, { streamingNumRetries: 5 }) // pages and texture levels
  explorer.setStreaming('streamingNumRetries', -1) // without end, from the next failure
  ```
- A simulated bandwidth, for trying a slow link: `streamingBandwidthLimit` is a bandwidth in
  megabytes a second, negative (`-1`, the default) for none. With one, a streaming page whose bytes
  are in is not installed at once: each frame gives each page the bytes the seconds since the frame
  before allow at that rate (`seconds · limit · 1 048 576`, whole bytes), counted against the size
  the page is stored in, before its install; a page that has bytes left makes the pages behind it
  wait. Each page takes a share of its own: the pages of a frame, up to
  `streamingMaxInstallsPerFrame` of them, each read their share, so the rate a test sees can be
  that many times the setting. The count of installs a frame is checked first, then the bandwidth,
  then the page is counted as installed — or, if its object went invalid meanwhile or its read
  failed for good, as dropped, its victim then given up with it. The clock is read once a frame,
  by the update that begins it or, when the engine counts a frame no update began, by the first
  page that asks, with the time that frame really took. `0` installs no streaming page; a root page
  (an HLOD cell's coarse page, a root-cover page) is installed whole, never slowed; a negative
  value gives no share, its clock still read, so the first frame a limit is set on has its real
  time (`geometry/residency/queueInstalls.ts`).

  ```ts
  const world = createWorld(canvas, { streamingBandwidthLimit: 2 }) // 2 MB/s
  explorer.setStreaming('streamingBandwidthLimit', -1) // unlimited again, from the next update
  ```
- The reads keep up: as many run at once as may be pending (`DEFAULT_PAGE_WORKERS`, 128), the
  transfer queue holding those pending pages at 128 KiB each (`DEFAULT_PAGE_TRANSFER_BYTES`,
  16 MiB, `session/engine/common.ts`), so neither bounds the streaming below its own settings.
- A region keeps a complete resident representation until every replacement page is uploaded: a
  streaming page is never a victim while a started or resident one depends on it.
- A page is resident for the cut once its bytes are in the pool and its clusters' records are
  written. The cut's list of visible clusters is written by the GPU each frame, sized by what the
  view draws (12 bytes a cluster, grown by the readback's peak), never by the placements: no table
  of drawn clusters is kept on the host, no cluster takes a slot of one. The records of the pages a
  frame installs are written that frame, whole, on no clock — its installs bound them
  (`geometry/clusters/clusterResidency.ts`) —; the pages the cut's requests ask spend the
  main-thread clock.
- Fetching and decoding stay in workers. The nine settings are world options, session options and
  render settings of the view distance's group; `explorer.setStreaming` changes them from the next
  update.

### Partitioned scenes

A partitioned scene ([FORMAT.md](format/prepared-scene-tables.md#world-partition)) is read as the camera reaches it,
never whole (`partition/`, `scene/drive/partitionFrame.ts`).

| Mechanism                               | Where                                                             |
| --------------------------------------- | ----------------------------------------------------------------- |
| The reach and its margin (`KEEP`)       | `partition/reach.ts:placedReach`, `partition/reach.ts:keepRadius` |
| The cell index walk and the cell decode | `partition/cellIndex.ts`, `partition/cellDecode.ts`               |
| Rows sized for the view, grown in place | `partition/sizing.ts`, `growth/growth.ts`                         |
| The world bundles the HLOD cells hold   | `partition/cellHolds.ts`                                          |
| Each HLOD cell wished, held and told    | `hlod/hlodCells.ts`, `dag/worlds/worldFollow.ts`                  |
| The placements an instanced HLOD actor makes | `hlod/hlodRows.ts`, `partition/placements.ts:placeActor`     |

- The error target never shortens the reach: a cell left unread would be missing, not coarser.
- The first frame reads the view's bytes, not the world's (`primePartitions`); cells, arrivals
  and texture tiles spend one main-thread clock per frame, in that order
  (`MAIN_THREAD_FRAME_MS`). The geometry pool's streaming pages spend none
  of it, nor the records of their clusters: a frame installs at most `streamingMaxInstallsPerFrame`
  of them.
- No image is presented before the main view has loaded once: every HLOD cell wished showing its
  own content, none on its actor nor asking, the cut waiting on no page, the residency queue and
  the clusters' records still (`viewLoading`, `WorldCells.shown`). Meanwhile every image is drawn unshown
  and that clock is the whole frame (`frame/loop/firstImage.ts`); once shown, none is withheld
  again.
- Placements are sized by reach, cell size and stretch, never by the world; outgrown, they grow in place
  (`growsInPlace`): the new placements appended into the room the GPU cut's tables kept, O(added)
  (`dag/pack/pack.ts`, `appendDagRoots`), or, past it, the cut made again over every root beside
  the running one at twice the capacity — once per image however many growths it brought, a
  logarithmic number of times —, the new placements drawn from the image that adopts them, whose first
  main cut runs whole (`growth/webgpuGrowth.ts`); the cut keeps room for the primitives and sources
  later growths bring (`DagCapacity.ahead`), and its list of visible clusters follows what the view
  draws, whatever the placements. A session whose engine cannot grow them leaves the cells past
  the placements waiting and says it by name (`onPartitionOutgrown`, `content-refused`): it is never opened
  again.
- A cell's HLOD actor stays drawn until what replaces it is ready (`dag/worlds/worldFollow.ts`).

## Out of memory

The public contract (refusal codes, `gpu-out-of-memory`, what the page sees) is
[SDK.md](sdk/memory-budgets.md#out-of-memory-is-absorbed); the shadow pool's is [SHADOWS.md](shadows/memory.md#memory).
One rule for every pool (`memory/outOfMemory.ts:halvedPool`): a refused pool is drawn again at
half its bytes, down to its floor; the pool in place is never replaced by one the device refused,
and no refusal loses the device.

| Where it is refused  | How it is answered                                                             |
| -------------------- | ------------------------------------------------------------------------------ |
| WebGPU pools         | `geometry/residency/poolGrants.ts`: a floor refused at prepare fails the session |
| WebGPU frame targets | `src/frame/prepare/targetGrant.ts`: Hi-Z leaves first, then the frames hold |
| WebGPU texture pool growth | `src/frame/io/memory.ts`: pool kept, asked again after a wait         |

A lost device takes the loss path ([SDK.md](sdk/memory-budgets.md#out-of-memory-is-absorbed)).

## Coverage counters

The fields are documented on the contract (`packages/sdk-core/src/contracts/metrics.ts`).

- `pagesDetached` is cut churn, never memory pressure; `cacheEvictions` is the pressure signal.
- `uncoveredTriangles` reads `null`: the cuts draw what they select, so no hole is counted.
- A failed URL is retried at most three times per session; a cover read failure rejects prepare.

## Virtual textures

| Mechanism                                        | Where                                              |
| ------------------------------------------------ | -------------------------------------------------- |
| Tile geometry, layer size, the pinned tail       | `texture/tiles.ts`                                 |
| Image feedback, one pixel in 256                 | `materials/virtual/feedback.ts`, `materials/virtual/reduce.ts` |
| Priority and prefetch of the requests            | `materials/virtual/requests.ts`                      |
| Victim queue, exact least recent use             | `materials/virtual/evictSortWgsl.ts`                 |
| Residency bias of an oversubscribed pool         | `materials/virtual/residencyBias.ts`                 |
| The WebGPU streamer and its two per-frame bounds | `virtual/streamer/streamer.ts`                          |
| Lanes and pools per atlas                        | `geometry/residency/memoryBudgets.ts`                |
| A pool grown where a lane runs out of places     | `frame/io/memory.ts` (`followTexturePressure`)       |
| A pose settled by `flush()`                      | `materials/virtual/converge.ts`                          |

- Memory is independent of the scene: tiles and layers are fixed, only the layer count follows the
  budget. Every texture's tail is resident from `prepare()`, so a missing tile is served by its
  finest resident ancestor, never a fill texel.
- The budget is room, not bytes taken: each lane's pool is made at its floor (its tails and one
  tile to stream into) and grows where it runs out of places. A lane whose arriving tiles find none
  (every place read of late) grows by one layer at each image it is still short, within its share
  of the budget, its tiles kept (`texture-pool-grown`); a pose settled by `flush()` waits for the
  growth and asks again. A growth the device or the budget refuses keeps the pool in place and is
  asked again after a wait.
- Uploads are bounded per frame by 32 tiles, then by the host's ceilings in bytes and in
  milliseconds; the first tile or map of a pass always goes. A stutter is read on the peak and the
  p95, never the median.
- Image feedback speaks for one pixel in each 16 × 16 square of the image, every pixel of the
  square once in 256 images, in an order that spreads the first of them over the square. The tiles
  it names are served by priority: the pixels that named a tile times one more than its level, the
  coarser first. A tile the pool serves three levels coarser or more also asks the tile two levels
  finer than the one served, which loads sooner than the level asked.
- A place no pixel read in the last 16 images is free to give; among those, the least recently read
  leaves first, exactly over the 31 images that follow, the finer level first inside an image.
- A pool whose places are above 95% in use or pinned raises a level offset every read of the
  atlases adds — at most 4 levels, by a fifth of the gap from 95% an image, and back down as fast
  while it has room; a pool whose pinned tails fill more than 65% of it has none. The pool keeps
  its size: a view too large for it reads coarser tiles, all textures alike
  (`materials/virtual/residencyBias.ts`).
- A texture reads the lane its chain was kept in by the compiler's quality gate
  ([FORMAT.md](format/textures.md#textures)): the engine never trades a pixel for memory on its own. A
  texture appended past the budget is refused (`TEXTURE_BUDGET`) and nothing drawn is evicted.
- A flushed pose is deterministic: nothing it reads is missing (`pose-settle`).
- The dicing reads the height map at the micro-triangles' corners, where no pixel posts a feedback
  request for it. Its tiles are therefore asked for once an image for the whole map, at the level a
  view's longest side over the dicing rate reads it at (`visibility/tessellation/warm.ts`); a tile that
  has not landed is read at a coarser level until it does.
