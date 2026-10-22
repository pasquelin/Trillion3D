# Residency

What stays in memory: the geometry pool, the cut that reads it, the virtual textures. A map: each
mechanism's rule is stated where it lives, and this page names the file and the rules that span
files. Paths are under `packages/sdk-browser/src/`. The budgets a host sets are
[SDK.md](SDK.md#memory-budgets); the raster that draws the cut is
[ENGINE.md](ENGINE.md#webgpu-page-raster); the shadow page pool is [SHADOWS.md](SHADOWS.md).

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
  Views share the cut's tables: a view whose cut still stands takes its draw mask back from its
  saved journal instead of cutting again (`dag/swap/swap.ts`), one region of the readout a view,
  made when the first view is drawn aside.
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
| WebGPU slots, a streaming page each, and a resize       | `src/frame/io/memory.ts`, `pages/pool/resize.ts`, `src/frame/prepare/growTables.ts` |
| The world HLOD's table, DAG and held bundles            | `hlod/worldRoots.ts`, `hlod/worldBundles.ts`                    |
| The world HLOD actors the cut draws                     | `hlod/worldHlod.ts`, `dag/worlds/worldFollow.ts`                    |
| Eviction by least recent use, never a page depended on  | `geometry/residency/streamedPages.ts`, `geometry/residency/queue.ts` |

- The pool's unit is the STREAMING PAGE: a compiled page of 128 KiB and 256 clusters at most
  ([FORMAT.md](FORMAT.md#cluster-dag)), a run-time cut's page alone where the cache gives none
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
| The streaming's eight settings                            | `packages/sdk-core/src/contracts/streamingOptions.ts`                       |
| The engine's frames, which pace the installs              | `geometry/integration/frameBudget.ts` (`createFrameGate`)                   |
| Rows, a cache of what the GPU cut draws and asks          | `geometry/rows/slots.ts`, `rows/demand/rowDemand.ts`, `geometry/rows/rowOrder.ts` |
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
  (`dag/lists/requestSize.ts`, `dag/queueGrowth.ts`). A cut past it is read by its head, its mask
  drawn whole.
- One update a frame, its requests read again whenever a view's readback is new, the capture's
  first. The requests are the streaming pages of the leaves every view asks for, each at the
  highest priority any view gives one of its pages, and of the pages they depend on, each at one
  more than the highest of its dependents — one per hop from streaming page to streaming page,
  however many groups a page holds, and theirs in turn as long as a priority rises
  ([FORMAT.md](FORMAT.md#cluster-dag)). The requested ones already started or resident move to
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
  for good is never started again by the session: a read that failed is tried again
  `streamingNumRetries` times (3; a negative value without end), after a wait of 0.5 s · 2^k, 8 s
  at most; past the last the page is given up, the object it names invalid, no page of it asked for
  again.
- The reads keep up: as many run at once as may be pending (`DEFAULT_PAGE_WORKERS`, 128), the
  transfer queue holding those pending pages at 128 KiB each (`DEFAULT_PAGE_TRANSFER_BYTES`,
  16 MiB, `session/engine/common.ts`), so neither bounds the streaming below its own settings.
- A region keeps a complete resident representation until every replacement page is uploaded: a
  streaming page is never a victim while a started or resident one depends on it.
- An instance is resident for the cut once its bytes are and it holds a row. The table holds what
  the cut draws and asks for, sized by the view, never by the placements: a request for an instance
  without a row takes a free row, or one no readback used for a while; one the table cannot serve
  grows it. The rows of the pages a frame installs are written that frame, whole, on no clock — its
  installs bound them (`geometry/rows/rowPasses.ts`, `followArrivals`) —; the rows the cut's
  requests claim spend the main-thread clock.
- Fetching and decoding stay in workers. The eight settings are world options, session options and
  render settings of the view distance's group; `explorer.setStreaming` changes them from the next
  update.

### Partitioned scenes

A partitioned scene ([FORMAT.md](FORMAT.md#world-partition)) is read as the camera reaches it,
never whole (`partition/`, `scene/drive/partitionFrame.ts`).

| Mechanism                               | Where                                                             |
| --------------------------------------- | ----------------------------------------------------------------- |
| The reach and its margin (`KEEP`)       | `partition/reach.ts:placedReach`, `partition/reach.ts:keepRadius` |
| The cell index walk and the cell decode | `partition/cellIndex.ts`, `partition/cellDecode.ts`               |
| Rows sized for the view, grown in place | `partition/sizing.ts`, `growth/growth.ts`                         |
| The world bundles the HLOD cells hold   | `partition/cellHolds.ts`                                          |
| Each HLOD cell wished, held and told    | `hlod/hlodCells.ts`, `dag/worlds/worldFollow.ts`                  |
| The rows an instanced HLOD actor places | `hlod/hlodRows.ts`, `partition/placements.ts:placeActor`          |

- The error target never shortens the reach: a cell left unread would be missing, not coarser.
- The first frame reads the view's bytes, not the world's (`primePartitions`); cells, arrivals,
  the row records the cut's requests claim and texture tiles spend one main-thread clock per
  frame, in that order (`MAIN_THREAD_FRAME_MS`). The geometry pool's streaming pages spend none
  of it, nor the rows of their pages: a frame installs at most `streamingMaxInstallsPerFrame` of
  them.
- No image is presented before the main view has loaded once: every HLOD cell wished showing its
  own content, none on its actor nor asking, the cut waiting on no page, the residency queue and
  the row table still (`viewLoading`, `WorldCells.shown`). Meanwhile every image is drawn unshown
  and that clock is the whole frame (`frame/loop/firstImage.ts`); once shown, none is withheld
  again.
- Rows are sized by reach, cell size and stretch, never by the world; outgrown, they grow in place
  (`growsInPlace`): the new placements appended into the room the GPU cut's tables kept, O(added)
  (`dag/pack/pack.ts`, `appendDagRoots`), or, past it, the cut made again over every root beside
  the running one at twice the capacity — once per image however many growths it brought, a
  logarithmic number of times —, the new rows drawn from the image that adopts them, whose first
  main cut runs whole (`growth/webgpuGrowth.ts`); the page table and the tables sized by its rows
  grow a factor at a time (`rowsAhead`), the cut keeps room for the primitives and sources later
  growths bring (`DagCapacity.ahead`). A session whose engine cannot grow them leaves the cells past
  the rows waiting and says it by name (`onPartitionOutgrown`, `content-refused`): it is never opened
  again.
- A cell's HLOD actor stays drawn until what replaces it is ready (`dag/worlds/worldFollow.ts`).

## Out of memory

The public contract (refusal codes, `gpu-out-of-memory`, what the page sees) is
[SDK.md](SDK.md#out-of-memory-is-absorbed); the shadow pool's is [SHADOWS.md](SHADOWS.md#memory).
One rule for every pool (`memory/outOfMemory.ts:halvedPool`): a refused pool is drawn again at
half its bytes, down to its floor; the pool in place is never replaced by one the device refused,
and no refusal loses the device.

| Where it is refused  | How it is answered                                                             |
| -------------------- | ------------------------------------------------------------------------------ |
| WebGPU pools         | `geometry/residency/poolGrants.ts`: a floor refused at prepare fails the session |
| WebGPU frame targets | `src/frame/prepare/targetGrant.ts`: Hi-Z leaves first, then the frames hold |
| WebGPU row tables    | `src/frame/prepare/growTables.ts`: pool and tables kept                     |

A lost device takes the loss path ([SDK.md](SDK.md#out-of-memory-is-absorbed)).

## Coverage counters

The fields are documented on the contract (`packages/sdk-core/src/contracts/metrics.ts`).

- `pagesDetached` is cut churn, never memory pressure; `cacheEvictions` is the pressure signal.
- `uncoveredTriangles` reads `null`: the cuts draw what they select, so no hole is counted.
- A failed URL is retried at most three times per session; a cover read failure rejects prepare.

## Virtual textures

| Mechanism                                        | Where                                              |
| ------------------------------------------------ | -------------------------------------------------- |
| Tile geometry, layer size, the pinned tail       | `texture/tiles.ts`                                 |
| Image feedback, one pixel in sixteen             | `materials/virtual/feedback.ts`, `materials/virtual/reduce.ts` |
| The WebGPU streamer and its two per-frame bounds | `virtual/streamer/streamer.ts`                          |
| Lanes and pools per atlas                        | `geometry/residency/memoryBudgets.ts`                |
| A pose settled by `flush()`                      | `materials/virtual/converge.ts`                          |

- Memory is independent of the scene: tiles and layers are fixed, only the layer count follows the
  budget. Every texture's tail is resident from `prepare()`, so a missing tile is served by its
  finest resident ancestor, never a fill texel.
- Uploads are bounded in bytes and in milliseconds per frame; the first tile or
  map of a pass always goes. A stutter is read on the peak and the p95, never the median.
- A texture reads the lane its chain was kept in by the compiler's quality gate
  ([FORMAT.md](FORMAT.md#textures)): the engine never trades a pixel for memory on its own. A
  texture appended past the budget is refused (`TEXTURE_BUDGET`) and nothing drawn is evicted.
- A flushed pose is deterministic: nothing it reads is missing (`pose-settle`).
