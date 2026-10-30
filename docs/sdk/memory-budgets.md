# Memory budgets

What a host sets and reads; pool mechanics: [RESIDENCY.md](../RESIDENCY.md).

| Setting | Default | What it is |
| - | - | - |
| `world.budget.gpu` | 2 007 MiB | all GPU pools, divided by `world.budget.split` |
| `world.budget.cpu` | page cache's default | what the world keeps in CPU memory |
| `world.budget.geometryPool` | 512 MiB | 128 KiB streaming-page slots, root pages in the root region; clamped to `geometryPoolCeiling` |
| `world.budget.texturePool` | 512 MiB | virtual-texture tiles, tails resident; clamped to `texturePoolCeiling` |
| `world.budget.canvas` | 3840 × 2160 | largest drawing buffer `{ width, height }`, effect targets reserved at it |
| `world.budget.physics` | `DEFAULT_PHYSICS_BUDGET` | [PHYSICS.md](../PHYSICS.md#budgets) |

- **GPU split.** Shadow pool, bounce probes, effect targets reserved first, then geometry and
  texture pools up to their ceilings. Root coverage and texture tails are mandatory.
- **GPU total.** Unset, it only divides the pools and refuses nothing. Set, it is also the
  allocation ceiling (`GPU_BUDGET_EXCEEDED`).
- **CPU split.** The page cache takes the CPU total (`split.pageCache`) minus manifest tables,
  transfer queue and cut tables. A change applies at once; entries leave by last use.
- **Live textures.** A video or per-frame canvas takes `textureLiveBytes` from the texture pool.
- **Canvas.** Declared larger, it grows the default total, or takes pool room under a page-set
  total. A canvas drawn past it is not shrunk; diagnostic `effect targets over budget` with the bytes past.
- **Pools.** A write is clamped to `geometryPoolCeiling` / `texturePoolCeiling` and to what `gpu`
  leaves, never under the floors. On WebGPU `geometryAllocationBytes` counts slots and vertex
  buffers. Two writes before the next frame settle in one rebalance; a budget set during prepare waits for prepare (`durationMs`).
  - Texture pool floor `minimum`: every tail (one tile per texture, 900 a layer) plus one tile to
    stream into, a layer more when tails fill whole layers.
  - It grows one layer at a time (`texture-pool-grown`); `texturePoolBytes` is what is held; a refused growth is retried after a wait.

Low-level `createGpuPageCache` pins in tiers: `cache.pin(key, 'held')` (root cover),
`cache.pin(key)` (ordinary); `cache.resize(slots)` keeps held, then pinned, then unpinned, newest
first; `cache.load(key, signal, 'held')` pins on arrival; repinning never lowers a held page;
`cache.unpin(key)` releases both.

- `units` names each key's streaming page and offset (`{ unit, offset }`); a `pageBytes` slot holds one streaming page; an unnamed key is a
  streaming page alone.
- `roots` (`{ slots, bytes }`) lays a root region behind the streaming slots: pages of the
  `rootUrls` keys take its grains of `bytes`. `cache.resize(slots, grown, roots)` lays it anew
  (current kept when absent); `cache.rootRoom()` counts free grains.
- `GeometryPool.roots` (the engine's region) opens at 2048 grains, grows with HLOD cells.

**Coarser, never refused.** What a view asks beyond a pool is drawn coarser (`coverageBudgetLimited`,
`geometryPoolSaturated`). A value that cannot be held is clamped, `geometryPoolClamp` /
`texturePoolClamp` naming why (`root-cover`, `scene`, `page-cap`, `minimum`, `device-limit`,
`ceiling`, or `null`). Only this is refused, by name:

| Code | When |
| - | - |
| `INVALID_GPU_BUDGET`, `INVALID_CPU_BUDGET`, `INVALID_GEOMETRY_POOL_BUDGET`, `INVALID_TEXTURE_POOL_BUDGET` | not whole bytes above zero |
| `INVALID_BUDGET_CANVAS` | canvas not whole pixels above zero |
| `GPU_BUDGET_UNDER_MINIMUM` | below root coverage and texture-tail minima |
| `GPU_BUDGET_UNDER_SHADOW_POOL` | under the fixed shadow share |
| `GEOMETRY_POOL_DEVICE_LIMIT` | device cannot hold the root cover |
| `TEXTURE_POOL_DEVICE_LIMIT` | device cannot hold one texture lane's tails |
| `WEBGPU_GEOMETRY_POOL_REFUSED`, `WEBGPU_TEXTURE_POOL_REFUSED`, `WEBGPU_FRAME_TARGETS_REFUSED` | device refuses a floor or the frame targets ([RESIDENCY.md](../RESIDENCY.md#out-of-memory)) |
| `GPU_BUDGET_EXCEEDED` | allocation past a set GPU total (or unknown format): no new image, flush and capture reject; terminal for the session, reopened with enough budget once every session sharing the cache is released |
| `SURFACE_DEVICE_LIMIT` | a device dimension limit |

## Out of memory is absorbed

No exception reaches the page. A refused pool is redrawn at half its bytes, down to its floor; a
frame waiting on a shadow pool or frame targets is held. `gpu-out-of-memory` names the pool,
`requestedBytes`, `grantedBytes` (`null` when even the floor was refused). See
[RESIDENCY.md](../RESIDENCY.md#out-of-memory), [SHADOWS.md](../shadows/memory.md#memory).

A lost device is recovered without a reload. Each reopen is said once as
`session-reopen`: `cause` (`device-lost` or `option`), `durationMs`, `framesWithoutImage`,
`keptPages`. Scene content gained joins in place; lost, it is parked. What
cannot (a pool or pass the device refuses, a picture resized where the atlas layout is fixed) is
said once as `content-refused` (`kind: 'error'`, `what`, `reason`).
