# Residency

What stays in memory: the geometry pool, the cut that reads it, the virtual textures. A map: each
mechanism's rule is stated where it lives, and this page names the file and the rules that span
files. Paths are under `packages/sdk-browser/src/`. The budgets a host sets are
[SDK.md](SDK.md#memory-budgets); the raster that draws the cut is
[ENGINE.md](ENGINE.md#webgpu-page-raster); the shadow page pool is [SHADOWS.md](SHADOWS.md).

## One cut rule per cluster

| Mechanism | Where |
|---|---|
| The predicate that draws or withholds a cluster | `page/cut/rule.ts:drawsCluster` |
| Its residency, by group and closed upward | `page/cut/readiness.ts` |
| The GPU kernel's copy and its CPU model | `gpu/dag/readiness.ts`, `gpu/dag/oracle/oracle.fixture.ts` |
| Whole groups asked of the cache | `page/cut/groupClosure.ts` |
| The CPU cut, in JavaScript and WebAssembly | `page/cut/take.ts`, `page/cut/held.ts`, `packages/page-codec-wasm/src/cut.rs` |

- One predicate on one readiness, the threshold always the host's. The WebGPU CPU path, its light
  cuts and WebGL2 draw through the CPU cut, with no fallback of their own.
- A missing page falls back to its nearest resident ancestor and coarsens its own neighbourhood by
  one level, never its primitive nor the root cover. Memory short, a page not uploaded yet, a
  dependency that does not fit and a shadow caster the pool lacks all fall back this way.
- Pruning drops a subtree only when none of its clusters has a missing finer group (`NODE_OPEN`),
  so that ancestor is always a candidate. No frame waits for coverage once the root cover is
  resident.
- The cut's state follows the view and the pool, never the catalogue
  (`page/cut/viewBound.test.ts`).

## The geometry pool

| Mechanism | Where |
|---|---|
| The fixed split of the world's GPU and CPU totals | `residency/memoryBudget.ts`, `residency/pools.ts` |
| The floor: root cover plus the group each root replaces | `residency/minimumCapacity.ts` |
| WebGPU slots beside the vertex buffers, and a resize | `webgpu/pages/io/memory.ts`, `webgpu/pages/prepare/growTables.ts` |
| The pinned world top | `scene/worldRoots.ts` |
| The world super-roots the cut draws | `scene/worldSuperRoots.ts`, `gpu/dag/worldMirror.ts` |
| Eviction by last use, parents after children | `residency/lastUse.ts` |

- Past the pool, the cut keeps the host's screen error: the pool loads what fits, coarsest first,
  and the cut rule draws the rest (`coverage-budget`). Memory never forces a cut the view refuses:
  both engines admit the floor's pages before any other, and a budget under the floor is raised
  to it by name (`root-cover`).
- The runtime pins the world top alone; object roots are pages the view holds. The session counts
  those bytes in its CPU budget.
- A resize copies what fits on the GPU and keeps the image complete; a refusal keeps the pool.

### WebGPU: admission and eviction

| Mechanism | Where |
|---|---|
| Install order: a page after the pages it depends on | `webgpu/residency/admission.ts` |
| One ranking for the GPU and the CPU cut | `webgpu/residency/requestAdmission.ts` |
| Requests ahead of a moving camera, a lower tier | `gpu/core/aheadView.ts`, `webgpu/residency/lowerTier.ts` |
| The main thread's share | `page/integration/frameBudget.ts` |
| The eviction queue the GPU cut publishes | `gpu/dag/evict.ts`, `gpu/dag/poolList.ts`, `webgpu/residency/evictionFeed.ts` |

- A region keeps a complete resident representation until every replacement page is uploaded. A
  page's dependencies are requested with it ([FORMAT.md](FORMAT.md#cluster-dag)); until they
  arrive, it is not loaded.
- The lower tier is never pinned, never evicts a camera page, and empties once the camera stops.
- The GPU cut keeps no ranking of its own; on its path the cache evicts only from its queue, finer
  level first, a key the latest cut read never listed. The CPU cut evicts the least recent page.
- Fetching and decoding stay in workers; admission yields past its share.

### WebGL2: the pool

The pool (`backend/autonomous/pool.ts`) is sized by the same rule and admits the wanted cut closed
over its groups, coarsest first, the floor's pages first (`backend/autonomous/requests.ts`). It
holds by the shared residency (`residency/lastUse.ts`, `backend/autonomous/poolOrder.ts`), so a
fallback ancestor never leaves under its surface; it bounds what the image asks for, never the
cut. A capture draws in its own view (`backend/autonomous/views.ts`) under the one budget. What
WebGL2 cannot carry it names in `capabilities.unsupported` and `render-capabilities`
(`backend/autonomous/capabilities.ts`); cast shadows: [SHADOWS.md](SHADOWS.md#webgl2-has-none).

### Partitioned scenes

A partitioned scene ([FORMAT.md](FORMAT.md#world-partition)) is read as the camera reaches it,
never whole (`partition/`, `world/scene/partitionFrame.ts`).

| Mechanism | Where |
|---|---|
| The reach and its margins (`AHEAD`, `KEEP`) | `partition/plan.ts:cellReach`, `partition/aheadShare.ts` |
| The cell index walk and the cell decode | `partition/cellIndex.ts`, `partition/cellDecode.ts` |
| Rows sized for the view, grown in place | `partition/sizing.ts`, `placement/growth.ts` |
| A WebGL2 manifest held by the placed cells | `partition/cellPages.ts`, `world/scene/partitionMounts.ts` |
| Cells held far, by their super-roots | `partition/farCells.ts`, `partition/superRoots.ts` |

- The error target never shortens the reach: a cell left unread would be missing, not coarser.
- The first frame reads the view's bytes, not the world's (`primePartitions`); cells, arrivals
  and row records share one integration budget per frame (`ARRIVAL_BUDGET_MS`).
- Rows are sized by reach, cell size and stretch, never by the world; outgrown, they grow in place
  (`growsInPlace`) or the owner reopens once (`onPartitionOutgrown`).
- A cell's super-roots stay while its objects are not drawable.

## Out of memory

The public contract (refusal codes, `gpu-out-of-memory`, what the page sees) is
[SDK.md](SDK.md#out-of-memory-is-absorbed); the shadow pool's is [SHADOWS.md](SHADOWS.md#memory).
One rule for every pool (`residency/outOfMemory.ts:halvedPool`): a refused pool is drawn again at
half its bytes, down to its floor; the pool in place is never replaced by one the device refused,
and no refusal loses the device.

| Where it is refused | How it is answered |
|---|---|
| WebGPU pools | `webgpu/residency/poolGrants.ts`: a floor refused at prepare fails that backend |
| WebGPU frame targets | `webgpu/pages/prepare/targetGrant.ts`: Hi-Z leaves first, then the frames hold |
| WebGPU row tables | `webgpu/pages/prepare/growTables.ts`: pool and tables kept |
| WebGL2 (`getError`, never holding a frame) | `webgl/core/allocation.ts`, `backend/autonomous/pool.ts` |

A lost context or device takes the loss path ([SDK.md](SDK.md#out-of-memory-is-absorbed)).

## Coverage counters

The fields are documented on the contract (`packages/sdk-core/src/contracts/metrics.ts`).

- `pagesDetached` is cut churn, never memory pressure; `cacheEvictions` is the pressure signal.
- `uncoveredTriangles` (WebGL2, `page/cut/result.ts`): zero is the only healthy value once
  `prepare` holds the root cover; WebGPU reads `null`, its cuts drawing what they select.
- A failed URL is retried at most three times per session; a cover read failure rejects prepare.

## Virtual textures

| Mechanism | Where |
|---|---|
| Tile geometry, layer size, the pinned tail | `texture/tiles.ts` |
| Image feedback, one pixel in sixteen | `webgpu/tile/feedback.ts`, `webgpu/tile/reduce.ts` |
| The WebGPU streamer and its two per-frame bounds | `webgpu/tile/streamer.ts` |
| Lanes and pools per atlas | `webgpu/residency/memoryBudgets.ts` |
| A pose settled by `flush()` | `webgpu/tile/converge.ts` |
| WebGL2 whole maps under the same bounds | `webgl/cluster/textureQueue.ts` |

- Memory is independent of the scene: tiles and layers are fixed, only the layer count follows the
  budget. Every texture's tail is resident from `prepare()`, so a missing tile is served by its
  finest resident ancestor, never a fill texel.
- Uploads are bounded in bytes and in milliseconds per frame on both engines; the first tile or
  map of a pass always goes. A stutter is read on the peak and the p95, never the median.
- A texture reads the lane its chain was kept in by the compiler's quality gate
  ([FORMAT.md](FORMAT.md#textures)): the engine never trades a pixel for memory on its own. A
  texture appended past the budget is refused (`TEXTURE_BUDGET`) and nothing drawn is evicted.
- A flushed pose is deterministic: nothing it reads is missing (`pose-settle`).
