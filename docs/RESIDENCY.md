# Residency

Geometry pool, the cut reading it, virtual textures. Paths under `packages/sdk-browser/src/`. Host
budgets: [SDK.md](sdk/memory-budgets.md#memory-budgets); raster drawing the cut:
[ENGINE.md](engine/webgpu-page-raster.md#webgpu-page-raster); shadow page pool:
[SHADOWS.md](SHADOWS.md).

## One cut rule per cluster

| Mechanism | Where |
| - | - |
| Predicate drawing a cluster | `geometry/cut/rule.ts:drawsCluster` |
| Residency by group, closed upward | `geometry/cut/readiness.ts` |
| GPU kernel's copy, its CPU model | `geometry/dag/readiness.ts`, `geometry/dag/oracle/oracle.fixture.ts` |
| Whole groups asked | `geometry/cut/groupClosure.ts` |
| CPU cut, kernel's test oracle | `geometry/cut/take.fixture.ts`, `geometry/cut/held.fixture.ts` |

- One predicate on one readiness; threshold is the host's. GPU cut is every view's
  (`geometry/dag/aside.ts`); CPU cut is the test reference. Views share cut tables and re-cut each
  image into their own visible-cluster list.
- Missing page (also: memory short, not uploaded, dependency that does not fit, shadow caster the
  pool lacks) falls back to the nearest resident ancestor, coarsening its neighbourhood one level,
  never its primitive nor the root cover.
- Pruning drops a subtree only if none of its clusters has a missing finer group (`NODE_OPEN`).
  Cut state follows view and pool, not the catalogue (`geometry/cut/viewBound.test.ts`).

## The geometry pool

| Mechanism | Where |
| - | - |
| Split of GPU and CPU totals | `memory/memoryBudget.ts`, `memory/pools.ts` |
| Root cover | `frame/prepare/rootCover.ts`, `geometry/residency/coverHolders.ts` |
| WebGPU slots; resize | `src/frame/io/memory.ts`, `pages/pool/resize.ts`, `src/frame/render/visibleTables.ts` |
| World HLOD table, DAG, bundles, actors | `hlod/worldRoots.ts`, `hlod/worldBundles.ts`, `hlod/worldHlod.ts` |
| LRU eviction | `geometry/residency/streamedPages.ts`, `geometry/residency/queue.ts` |

- Unit: the STREAMING PAGE, a compiled page of 128 KiB resident, 256 clusters at most
  ([FORMAT.md](format/clustersjson.md#cluster-dag)); a run-time cut's page alone where the cache
  gives none (`geometry/rows/page/pageSlots.ts:pageUnit`, `geometry/residency/pageUnits.ts`). One
  slot, one page (`pages/pool/placement.ts`). Slots = the streaming pages `geometryPoolBytes`
  (512 MiB default) holds, each the widest streaming page's size; then the ROOT REGION of grains,
  each the widest root page's size, 32 KiB at most for a compiled one (`RootSlots`). A ROOT PAGE
  (root cover's, or an HLOD cell's while its actor is loaded) takes a free grain, freed when its cell
  releases it (`residency/pinUpdater.ts`). Region opens at 2048 grains
  (`DEFAULT_INITIAL_ROOT_PAGES`) within the catalogue's root pages, at least the root cover's
  (`frame/prepare/rootCover.ts`, `rootRegionOf`); grows to the grains asked, rounded up to two
  significant bits (`frame/io/memory.ts`, `growWebgpuRootRegion`). A budget with no streaming slot
  says so (`root-cover`).
- A page lands INSTALLED: pool stages the on-disk bytes ([FORMAT.md](format/pages.md#pages));
  compute passes transcode them into the resident page at the end of the microtask turn staging the
  batch's first. Pass 1 (workgroup per page) unpacks strips, writes every vertex the page stores.
  Pass 2 (a level of pages per dispatch) copies vertices a page names from the clusters holding them
  (`dependencies`: one page of each streaming page of the closed list in the page's bundle,
  installed before it). Files: `geometry/residency/queueInstalls.ts`,
  `geometry/pages/install/installer.ts`, `transcodeWgsl.ts`, `pages/pool/commit.ts`. Space taken =
  resident bytes (`geometry.residentBytes`); a page wider than its room is left unwritten (version
  word zeroed); the source refuses one the manifest does not size (`frame/backend/readPage.ts`).
  Voxel brick and index pages are written as is.
- Past the pool the cut keeps the host's screen error: pool holds the most recently asked pages, the
  rest draws by resident parents (`coverage-budget`).
- Runtime pins the world top alone; object roots are view-held pages, counted in the session's CPU
  budget. Resize copies what fits; a refusal keeps the pool.

### WebGPU: streaming and eviction

| Mechanism | Where |
| - | - |
| Requests per view, GPU priorities | `dag/request/request.ts`, `gpu/core/selection.ts` |
| Requests, dependencies | `geometry/residency/pageRequests.ts` |
| Update: pages, victims, installs | `geometry/residency/queue.ts`, `queueStarts.ts`, `queueInstalls.ts` |
| Pool-pressure quality | `geometry/residency/poolPressure.ts`, `frame/render/gpuCut.ts` |
| Nine settings | `packages/sdk-core/src/contracts/streamingOptions.ts` |
| Pacing installs | `geometry/integration/frameBudget.ts` (`createFrameGate`) |
| Cluster records; visible list | `geometry/clusters/clusterResidency.ts`, `geometry/clusters/infoWrite.ts`,
`geometry/dag/visible/visibleGrowth.ts`, `geometry/dag/visible/layout.ts` |
| Root cover pins | `geometry/residency/pinUpdater.ts`, `pages/pool/eviction.ts` |

- A view asks for a LEAF of the culling tree (clusters of one group; consecutive packed pages) in one
  three-word request: first page, page count, priority. Readout holds one request per leaf; its two
  lists start at `streamingMinRequests` (65 536); grow to a quarter over what a readback asked when
  two in a row asked more than held; give back a fiftieth per readback after thirty under half; cap
  `streamingMaxRequests` (1 048 576); both 4 096 to 1 048 576 (`dag/lists/requestSize.ts`,
  `dag/queueGrowth.ts`). A cut past it is read by its head.
- One update per frame; requests re-read when a view's readback is new. Requests: streaming pages of
  the leaves every view asks for, each at the highest priority any view gives one of its pages; plus
  pages they depend on, each at one more than its highest dependent (one per hop). Requested pages
  already started or resident move to the use order's end, views' own first. `prefetch` (residency
  queue's third argument) asks pages at a caller priority, kept up to 0xffffffe0, none at 0; left
  out, asked ahead of every view's request, nearer deadline higher.
- Unique requests, as percent of streaming pool slots, scale the cut's screen error (GPU cut divides
  its pixel threshold by it): over `streamingQualityMaxPoolPercent` (85) two updates running, scale
  falls 3 % an update to `streamingQualityMinScale` (0.3); under `streamingQualityMinPoolPercent`
  (70) thirty updates running, rises 1 % an update to 1.
- New streaming pages (requested, neither started nor resident) start highest priority first, at most
  `streamingMaxPendingPages` (128) less pending. Each takes a free slot, else the first streaming
  page in use order that this update does not request, has landed, holds no root cover page, and that
  no started or resident page depends on; none left, no more starts.
- Started pages install in start order once their bytes are in, at most
  `streamingMaxInstallsPerFrame` (128, never above pending) per frame; one whose object turned
  invalid meanwhile is dropped on arrival.
- A failed read (network error, 5xx, 404) is requeued at once, up to `streamingNumRetries` times (3
  default; negative = endless). First failure (warning) and give-up (the failure) are said once;
  after give-up the page's object is invalid and none of its pages are read. Only wait: server's
  `Retry-After` (10 s at most). Baked texture levels: same (`geometry/streaming/failures.ts`).

  ```ts
  const world = createWorld(canvas, { streamingNumRetries: 5 }) // pages and texture levels
  explorer.setStreaming('streamingNumRetries', -1) // without end, from the next failure
  ```
- Simulated bandwidth: `streamingBandwidthLimit` in MB/s, negative (`-1`, default) = none. With one,
  each frame gives each page whose bytes are in `seconds · limit · 1 048 576` whole bytes (seconds
  since the previous frame), counted against the page's stored size, before install; a page with
  bytes left makes pages behind it wait. Checks in order: installs per frame, bandwidth, installed
  (or dropped if invalid or failed). `0` installs no streaming page; a root page (HLOD cell's coarse
  page, root-cover page) installs whole, never slowed (`geometry/residency/queueInstalls.ts`).

  ```ts
  const world = createWorld(canvas, { streamingBandwidthLimit: 2 }) // 2 MB/s
  explorer.setStreaming('streamingBandwidthLimit', -1) // unlimited again, from the next update
  ```
- `DEFAULT_PAGE_WORKERS` 128 reads; `DEFAULT_PAGE_TRANSFER_BYTES` 16 MiB (`session/engine/common.ts`).
- A streaming page is never a victim while a started or resident page depends on it. Visible-cluster
  list: 12 bytes a cluster.
- The nine settings are world, session and render options; `explorer.setStreaming` changes them
  from the next update.

### Partitioned scenes

A partitioned scene ([FORMAT.md](format/prepared-scene-tables.md#world-partition)) is read as the
camera reaches it (`partition/`, `scene/drive/partitionFrame.ts`).

| Mechanism | Where |
| - | - |
| Reach and margin (`KEEP`) | `partition/reach.ts:placedReach`, `partition/reach.ts:keepRadius` |
| Cell index walk, decode | `partition/cellIndex.ts`, `partition/cellDecode.ts` |
| Rows sized, grown in place | `partition/sizing.ts`, `growth/growth.ts` |
| Bundles HLOD cells hold | `partition/cellHolds.ts` |
| HLOD cell wished, held, told | `hlod/hlodCells.ts`, `dag/worlds/worldFollow.ts` |
| Instanced HLOD actor placements | `hlod/hlodRows.ts`, `partition/placements.ts:placeActor` |

- Error target never shortens reach: a cell left unread would be missing, not coarser.
- A cell's HLOD actor stays drawn until its replacement is ready (`dag/worlds/worldFollow.ts`).
- First frame reads the view's bytes (`primePartitions`); cells, arrivals, texture tiles spend one
  main-thread clock per frame, in that order (`MAIN_THREAD_FRAME_MS`); streaming pages spend none.
- No image is presented until the main view has loaded once: every wished HLOD cell showing its own
  content, cut waiting on no page (`viewLoading`, `WorldCells.shown`; `frame/loop/firstImage.ts`);
  once shown, none is withheld again.
- Placements are sized by reach, cell size, stretch; outgrown, they grow in place (`growsInPlace`):
  appended into room the cut's tables kept (`dag/pack/pack.ts`, `appendDagRoots`); past it, cut
  remade over every root at twice the capacity, first main cut whole (`growth/webgpuGrowth.ts`;
  `DagCapacity.ahead`). An engine that cannot grow them leaves cells past the placements waiting,
  said by name (`onPartitionOutgrown`, `content-refused`), never opened again.

## Out of memory

Public contract (refusal codes, `gpu-out-of-memory`, what the page sees):
[SDK.md](sdk/memory-budgets.md#out-of-memory-is-absorbed); shadow pool's:
[SHADOWS.md](shadows/memory.md#memory). Every pool (`memory/outOfMemory.ts:halvedPool`): a refused
pool is redrawn at half its bytes, down to its floor.

- Pools (`geometry/residency/poolGrants.ts`): floor refused at prepare fails the session.
- Frame targets (`src/frame/prepare/targetGrant.ts`): Hi-Z leaves first, then frames hold.
- Texture pool growth (`src/frame/io/memory.ts`): pool kept, asked again after a wait.
- Lost device: the loss path.

## Coverage counters

Contract: `packages/sdk-core/src/contracts/metrics.ts`.

- `pagesDetached` = cut churn; `cacheEvictions` = pressure signal. `uncoveredTriangles` is `null`.
- A failed URL is retried at most 3 times a session; a cover read failure rejects prepare.

## Virtual textures

| Mechanism | Where |
| - | - |
| Tile geometry, layer size, pinned tail | `texture/tiles.ts` |
| Image feedback | `materials/virtual/feedback.ts`, `materials/virtual/reduce.ts` |
| Request priority, prefetch | `materials/virtual/requests.ts` |
| Victim queue, exact LRU | `materials/virtual/evictSortWgsl.ts` |
| Residency bias | `materials/virtual/residencyBias.ts` |
| Streamer | `virtual/streamer/streamer.ts` |
| Lanes and pools | `geometry/residency/memoryBudgets.ts` |
| Pool growth | `frame/io/memory.ts` (`followTexturePressure`) |
| `flush()` pose | `materials/virtual/converge.ts` |

- Only layer count follows budget. Every texture's tail is resident from `prepare()`; a missing tile
  uses its finest resident ancestor.
- Each lane's pool starts at its floor (tails + one tile). A lane whose arriving tiles find no place
  grows one layer per image while short, within its budget share (`texture-pool-grown`); `flush()`
  waits for the growth. A refused growth keeps the pool, asked again after a wait.
- Uploads per frame: 32 tiles, then host ceilings in bytes and ms; a pass's first tile goes.
- Image feedback: one pixel per 16 × 16 square, every square pixel once in 256 images. Named tiles
  served by priority: pixels that named a tile times (its level + 1), coarser first. A tile served
  three or more levels coarser also asks the tile two levels finer.
- A place unread for 16 images is free; least recently read leaves first, over the following 31
  images, finer level first within an image.
- A pool with places above 95% in use or pinned adds a level offset to every atlas read (at most 4
  levels, up by a fifth of the gap from 95% per image, down as fast); none when pinned tails fill
  over 65% (`materials/virtual/residencyBias.ts`).
- A texture's lane is set by the compiler's quality gate ([FORMAT.md](format/textures.md#textures)).
  A texture appended past budget is refused (`TEXTURE_BUDGET`); nothing drawn is evicted.
- Dicing's height-map tiles are asked once an image, at the level a view's longest side over the
  dicing rate reads (`visibility/tessellation/warm.ts`). A flushed pose is deterministic
  (`pose-settle`).
