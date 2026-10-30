# Memory budgets

What a host sets and reads; the pools' mechanics are [RESIDENCY.md](../RESIDENCY.md).

| Setting                     | Default                      | What it is                                                                                                                                                   |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `world.budget.gpu`          | 2 007 MiB                    | every GPU pool together, divided by `world.budget.split`                                                                                                     |
| `world.budget.cpu`          | the page cache's own default | what the world keeps in CPU memory                                                                                                                           |
| `world.budget.geometryPool` | 512 MiB                      | slots of a 128 KiB streaming page each, the root pages held beside them in the root region; clamped to `geometryPoolCeiling`; the call a memory slider makes |
| `world.budget.texturePool`  | 512 MiB                      | virtual-texture tiles, every texture's tail always resident; clamped to `texturePoolCeiling`; the room the pool grows into, never bytes taken up front       |
| `world.budget.canvas`       | 3840 × 2160                  | the largest drawing buffer, `{ width, height }`, the effect targets are reserved at                                                                          |
| `world.budget.physics`      | `DEFAULT_PHYSICS_BUDGET`     | [PHYSICS.md](../PHYSICS.md#budgets)                                                                                                                             |

- **GPU split.** The shadow pool, bounce probes and effect targets are reserved first (at
  their live descriptor bytes), then the geometry and texture pools up to their ceilings; root
  coverage and texture tails are mandatory, and admission never changes resolution or raises the
  declared total.
- **GPU total.** Unset, it only divides the pools — it grows with what the session holds, so the
  pools keep their defaults — and refuses nothing: the passes make their targets in the middle of a
  frame, and no allocation is ever refused for it. Set, it is also the ceiling on what the world
  allocates (`GPU_BUDGET_EXCEEDED` below).
- **CPU split.** The decoded-page cache takes the whole CPU total (`split.pageCache`): manifest
  tables, transfer queue and cut tables (sized by the view and the pool, never the world) are
  reserved off it, and its entries — pages, decoded baked texture levels and files read whole —
  share the rest under one budget. A change applies
  at once, entries leaving by last use, never one a frame keeps.
- **Live textures.** A video or a canvas redrawn every frame takes its working texture,
  `textureLiveBytes`, from the texture pool; the recorded budget stays the declared one.
- **Canvas.** Declared larger, it grows the default total, or takes room from the pools under a
  page-set total. A canvas drawn past it is never shrunk; the diagnostics say `effect targets over
budget` with the bytes past the reserve.
- **Pools.** A read gives what the engine holds; a write is clamped to `geometryPoolCeiling` /
  `texturePoolCeiling` and to what `gpu` leaves beside the shadows and the other pool, never under
  the floors (the root cover, the texture tails). On WebGPU `geometryAllocationBytes` counts the
  slots and the vertex buffers beside them. Two writes before the next frame settle in one
  rebalance, the image complete throughout; a budget set during prepare is the later word, its
  report (`durationMs`) waiting for prepare. The texture pool's floor, `minimum`, holds every tail
  (one tile per texture, 900 a layer) plus one tile to stream into, a layer more when the tails
  fill whole layers; a shrink never displaces a tail. The pool is made at that floor and grows where
  a lane runs out of places — its arriving tiles find none —, one layer at a time within the
  budget (`texture-pool-grown`), so `texturePoolBytes` is what is held, not the budget; a growth
  the device refuses keeps the pool and is asked again after a wait.

The low-level `createGpuPageCache` pins in tiers: `cache.pin(key, 'held')` for the root cover,
`cache.pin(key)` for ordinary pins; `cache.resize(slots)` keeps held pages, then pinned, then
unpinned, newest first in each; `cache.load(key, signal, 'held')` pins a page as it arrives;
repinning never lowers a held page; `cache.unpin(key)` releases both. Its `units` option names each
key's streaming page and offset there (`{ unit, offset }`): a slot of `pageBytes` holds one
streaming page, its pages packed at their offsets, a victim's slot given up with every page of it;
a key it names none of is a streaming page alone. Its `roots` option (`{ slots, bytes }`, counted
in `slots`) lays a root region behind the streaming slots: the streaming pages of the `rootUrls`
keys — the root pages — take its grains of `bytes`, never a streaming slot;
`cache.resize(slots, grown, roots)` lays it anew, the one in place kept when absent, and
`cache.rootRoom()` counts its free grains. `GeometryPool.roots` is the region the engine draws: it
opens at 2048 grains within the scene's root pages and grows as HLOD cells hold theirs.

**Coarser, never refused.** What a view asks beyond a pool is drawn coarser, by
the nearest resident ancestor or a texture tile's coarser level: `coverageBudgetLimited` and
`geometryPoolSaturated` say so. A value that cannot be held as given is brought to what can,
`geometryPoolClamp` / `texturePoolClamp` naming why (`root-cover`, `scene`, `page-cap`, `minimum`,
`device-limit`, `ceiling`, or `null`). Only this is refused, by name:

| Code                                                                                                      | When                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_GPU_BUDGET`, `INVALID_CPU_BUDGET`, `INVALID_GEOMETRY_POOL_BUDGET`, `INVALID_TEXTURE_POOL_BUDGET` | a value that is not a whole number of bytes above zero                                                                                                                                                                     |
| `INVALID_BUDGET_CANVAS`                                                                                   | a declared canvas that is not a whole number of pixels above zero                                                                                                                                                          |
| `GPU_BUDGET_UNDER_MINIMUM`                                                                                | a GPU total below the root coverage and texture-tail minima                                                                                                                                                                |
| `GPU_BUDGET_UNDER_SHADOW_POOL`                                                                            | a GPU total under its fixed shadow share                                                                                                                                                                                   |
| `GEOMETRY_POOL_DEVICE_LIMIT`                                                                              | a device whose limits cannot hold even the root cover                                                                                                                                                                      |
| `TEXTURE_POOL_DEVICE_LIMIT`                                                                               | a device whose limits cannot hold the tails of one texture lane                                                                                                                                                            |
| `WEBGPU_GEOMETRY_POOL_REFUSED`, `WEBGPU_TEXTURE_POOL_REFUSED`, `WEBGPU_FRAME_TARGETS_REFUSED`             | the device refuses a floor or the frame targets ([RESIDENCY.md](../RESIDENCY.md#out-of-memory))                                                                                                                               |
| `GPU_BUDGET_EXCEEDED`                                                                                     | an allocation past a GPU total the page set (or an unknown format): no new image, flush and capture reject; terminal for the session, reopened with enough budget once every session sharing the refused cache is released |
| `SURFACE_DEVICE_LIMIT`                                                                                    | a device dimension limit                                                                                                                                                                                                   |

## Out of memory is absorbed

The browser may refuse an allocation the budget allows; no exception reaches the page. A refused
pool is drawn again at half its bytes, down to its floor, the frame going on coarser; a frame
waiting on a shadow pool or frame targets is held, never drawn without its shadows. The
`gpu-out-of-memory` diagnostic names the pool, bytes asked (`requestedBytes`) and granted
(`grantedBytes`, `null` when even the floor was refused). How it is detected and answered:
[RESIDENCY.md](../RESIDENCY.md#out-of-memory); the shadow pool: [SHADOWS.md](../shadows/memory.md#memory).

A lost device is recovered without a reload: the session reopens on a new
device and rebuilds from the decoded-page cache, fetching nothing it still holds, the canvas keeping
its last image. Each session reopen, a recovery included, is said once as `session-reopen`:
`cause` (`device-lost` or `option`, nothing else: no change to the scene's content opens a session
again), `durationMs` (from the loss, for a lost device), `framesWithoutImage`, `keptPages`. A mesh, a material, a model with its
cells or a world the scene gains joins the running session in place, and one it loses is parked.
What the session cannot take in place — a pool or a pass the device refuses, a picture that changed size where the atlas layout is fixed — is said by name,
once, as `content-refused` (`kind: 'error'`, `what`, `reason`); the rest of the scene is drawn as it
was.
