# Audit: lava lamp (blobs-that-merge) CPU per frame, 4177 vs 4178

Read-only audit, 2026-10-03. Headless Chrome, 1728x1117 DPR 2, page `#/fr/examples/blobs-that-merge`,
camera at rest after the opening, heat 1. Tools: CDP `Profiler` (200 us sampling, 10 s window)
plus `Profiler.startPreciseCoverage({callCount})` for calls per frame; frames counted by a rAF
counter injected in the example iframe. Scripts: scratchpad `lava/full.mjs`, `rep.mjs`,
`callers.mjs`, `fcount.mjs`.

## Important: what the example really does

The wax does not deform. 160 meshes are cooked once at load (`cook`, all in the scene, hidden).
Every ~62 ms (16 wax frames/s at heat 1) one mesh is hidden and the next shown (`frames[...].visible`).
To the engine these meshes are rows of a batch: `visible` parks or takes a row
(`placement/update.ts:91-95`). There is no `deformOutput`, no per-frame vertex rewrite.

## Measured (headless; JS on the main thread, ms per rendered frame)

Headless absolute values are 5-30x below the boss's panel on both servers (page preparation
0.15 ms here vs 4.5 ms there, on both): his machine was loaded. The ratio and the culprit carry over.

| | 4177 run A | 4177 run C | 4178 run A | 4177 + demotion disabled (patch) |
|---|---|---|---|---|
| fps (rAF, GPU-bound headless) | 19.6 | 16.6 | 29.5 | 21.2 |
| JS busy ms/frame | 5.94 | 6.67 | 4.27 | **4.27** |
| `uploadRowMobility` incl. (`tv`) | **1.87** | **2.24** | 0.10 (`Dk`) | **0.02** |
| `mobility.writeRows` self | 1.04 | 1.24 | 0.06 | ~0 |
| writeRows rows walked / frame | 11 730 | ~12 500 | dirty rows only | dirty rows only |
| `shadowBinOf` (`xc`) calls / frame | 23 459 | 25 015 | - | - |
| shadow planning + encoding, without the above | ~0.8 (`t5` minus `tv`) | | 1.36 (`sj`, atlas) | |
| `planVirtualShadowFrame` (`f_`) incl. | 0.57 | | - | 0.5 |
| `encodeVsmFrame` (`IA`) incl. (render chunks, bins, bind groups) | 0.29 | | - | |
| `retainedRanks`/`mark` (same code both sides) | 0.82 | | 0.71 | 0.8 |

Where the 1.9-2.2 ms of `uploadRowMobility` is called from (profile stacks, run C):
- 1.14 ms: `encodeDraws` -> `uploadRowMobility(rows.dirtyFrom, rows.dirtyTo)` (`webgpu/pages/render/encodeDraws.ts:45`)
- 1.10 ms: `planVsmFrame` -> `mobility.settle()` -> `uploadRowMobility(0, -1)` (`webgpu/pages/render/vsm/vsmEncode.ts:281-285`)

Coverage, run C, per frame: `mobility.move` 1.57, `mobility.settle` 0.99, `writeRows` 1.78,
`set visible` 1.57 (a hide and a show per wax step). Each `writeRows` walks all ~11.7k caster
slots and calls three closures per row.

Proof of cause: patching the served chunk so that `settle()` returns at once (develop's behaviour:
a placement never turns static again) brings JS busy from 5.9-6.7 down to 4.27 ms/frame, equal to
develop, and `uploadRowMobility` from 2.2 to 0.02 ms.

The suspects in the brief that are NOT the cause here: VSM raster chunk encoding (whole
`encodeVsmFrame` is 0.29 ms), per-page bins / marking writeBuffer (< 0.05 ms), transmission pass
(`BC` 0.008 ms), deforming rows (none in this scene), bind-group re-creation (0.04-0.06 ms).
Without the mobility churn, VSM CPU (~0.8 ms) is cheaper than develop's atlas planning (1.36 ms).

## Root causes, ranked

### 1. A visibility flip is taken as a move, and the new demotion makes it recur forever (~95% of the delta)

- `placement/update.ts:94-95`: a row taken or parked calls `posed(rank, world, flipped)` with
  `forced = flipped`, i.e. hide/show = move.
- `placement/webgpuPlacements.ts:48-56`: that becomes `mobility.move(rank, world, true)` ->
  `MOVE_PROMOTED` the first time -> `wholeRows = true` (`webgpu/shadow/mobility.ts:111-116`).
- New on this branch, `webgpu/shadow/mobility.ts:124-137` (`settle`, FramesStaticThreshold 100,
  called every frame from `vsmEncode.ts:281`): 100 frames after the mesh was hidden it turns
  static -> `wholeRows = true` again, plus a static-page invalidation of its box (`vsmEncode.ts:283`).
- Each mesh is shown once per 10 s loop (> 100 frames), so every wax step costs one promotion and
  one demotion: two whole-table rewrites (`mobility.ts:156-160` forces `from = 0, to = rowCount-1`)
  and two static-page invalidations (also GPU work: static slice redrawn).
- On develop the same promotion happens once per mesh, never again (no demotion), so the cost
  vanishes after the first loop.

Fix (engine-only, any scene):
- Hide/show is not a move. A visibility change should remove/re-add the primitive's render
  state and invalidate its pages (static and dynamic) once; only a transform update marks a
  primitive as dynamic and refreshes its last-moved frame, so a park/take does not pay the
  promote/demote walk. In `placement/update.ts:95` pass `forced = false` for a pure park/take, and declare
  the flipped box through `touched(..., movingOnly = mobility.moves(rank))` / `plan.worldChanged`
  without calling `mobility.move`. A row that is both moved and flipped stays a move.
- Expected: no promotion or demotion in this scene, `uploadRowMobility` 2 ms -> ~0.02 ms,
  2 fewer static invalidations per wax step.

### 2. Promotion/demotion rewrites the whole mobility table (O(rows) instead of O(rows of the placement))

- `webgpu/shadow/mobility.ts:115,135,156-160` (`wholeRows`), `webgpu/shadow/bounds.ts:23-58`
  (`uploadRowMobility`, three closures per row, `writeBuffer` of the whole span).
- Even with fix 1, any scene with objects that move then rest (physics bodies, doors, characters)
  pays a full 11k+-row walk on every promote and every demote.

Fix: upload only the dirty primitives, not the whole buffer. `move()` and `settle()` should record the ranks that changed; `writeRows`
then rewrites only those placements' rows (placement -> row span index, which the page table
already has via `rootOfPacked` / `packedPageIndex`, built once per layout) and pushes one
`writeBuffer` per contiguous span. Also: keep a list of moving ranks so `settle` walks
`movingCount` entries, not every placement.
Expected: promote/demote cost ~0 (tens of rows), independent of scene size.

### 3. Per-frame allocations in the VSM CPU plan (~0.2-0.5 ms, scales with lights)

- `vsm/frameSetup.ts:162,183,190-196`: `JSON.stringify` shape key per light, a `Set` and a `Map`
  per frame; `:243` a new `VsmMapIds`; `:84-86` `writeNextMap` allocates an object and a
  spread array per map entry (16-17 calls/frame); `:294` `[...cache.entries.values()].some(...)`.
- `webgpu/pages/render/vsm/vsmEncode.ts:361-372` entries array + `vsmBuildPerPageBins` per frame;
  `:386` `new Uint32Array(directional)` per frame.

Fix: keep these as reused typed scratch on `VsmFrameState` (compare light fields directly, not a
JSON string; write next data straight into `nextMapsImage`; rebuild per-page bins only when the
entry set changes). The per-light CPU work stays; only the allocations go.
Expected: 0.2-0.4 ms headless; mostly GC pressure removed.

### Not a cause (checked)

`retainedRanks`/`mark` (0.7-0.8 ms) is identical on develop. VSM render-pass chunk encoding,
marking/per-page uploads, the transmission pass and bind groups together stay under 0.3 ms.
This is as intended: `encodeVsmFrame` encodes a fixed number of GPU-driven dispatches per frame.

## Expected gain

Fix 1 alone removes the whole measured delta: headless 5.9-6.7 -> 4.27 ms JS per frame (patch
measured), equal to develop. Scaled to the boss's panel, that is the ~8 ms of extra "image CPU"
(19.6 -> ~11). Fix 2 makes the same scenario cheap for real moving-then-resting objects. Fix 3
then puts 4177 below develop on CPU (VSM planning ~0.5 ms cheaper than the atlas).
