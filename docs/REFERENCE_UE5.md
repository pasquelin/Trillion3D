# The Reference in Numbers

What the reference publishes, compared to what this repository maintains. A single purpose: to answer
"do we have the same numbers as they do on the web", without assumptions or fabricated metrics.

Three categories, each compared differently:

1. **Structural constants** compare directly: they are format numbers, not measurements.
   `test/integration/reference-ue5.test.mjs` verifies them in code on every `pnpm test` and fails
   when any of them diverges from this table.
2. **Bytes per triangle** compare per triangle, never per scene: the reference scene is not ours.
3. **Milliseconds do not compare directly**: their profile was recorded on a console demo, ours
   on a laptop GPU. The [contribution guidelines](../CONTRIBUTING.md) require identical input, camera, quality, machine, and budget;
   none of the five match. They are listed here for profile SHAPE — what pass costs what — and
   for the one figure that crosses hardware: per-frame CPU cost.

All "reference" values originate from the SIGGRAPH 2021 talk *A Deep Dive into Nanite Virtualized
Geometry* (Karis, Stubbe, Wihlidal), except two lines marked **(2)** (secondary source) and one
sentence marked **(3)** (unsourced). No reference code, shader, or asset is read, quoted, or ported
here — only published figures.

## 1. Structure — Verified by Automated Tests

| Metric                        | Reference    | WebGeometry | Evidence                        |
| ----------------------------- | ------------ | ----------- | ------------------------------- |
| Triangles per cluster         | 128          | 128         | `dag.rs:DAG_CLUSTER_TRIANGLES`  |
| Vertices per cluster          | —            | 255         | `dag.rs:DAG_CLUSTER_VERTICES`   |
| Clusters per group, floor     | 8            | 8           | `dag.rs:DAG_GROUP_MIN`          |
| Clusters per group, ceiling   | 32           | 32          | `dag.rs:DAG_GROUP_MAX`          |
| Streaming bundle / page       | 128 KiB (2)  | 128 KiB     | `lib.rs:STREAM_BUNDLE_BYTES`    |
| Bootstrap object              | —            | 1 MiB       | `lib.rs:BOOTSTRAP_BUNDLE_BYTES` |

Three nuances not visible in the table:

- **Group floor is not enforced.** `dag/groups.rs` splits when a group exceeds `DAG_GROUP_MAX` but
  does not enforce `DAG_GROUP_MIN`: a group of 2 clusters is accepted where the reference requires 8.
- **`CLUSTER_TRIANGLES = 256` remains in `lib.rs`**, dead, alongside the active 128.
- **Residency budget is counted in bytes, matching the reference.** The reference allocates a fixed
  size in megabytes — 512 MB by default, excluding root pages **(2)** — and root pages are always
  resident. Our engine matches: `geometryPoolBytes`, 512 MiB default, converted to slots sized to the
  largest page, and never below root coverage (`pinned`, `docs/FORMAT.md`). Two differences to our
  advantage: in-session adjustment retains what fits in the new pool where the reference flushes, and
  a full pool is neither an exception nor a log warning, but a counter (`geometryPoolSaturated`)
  and a coarser cut.

## 2. Bytes per Triangle — The Sole Valid Memory Comparison

The reference on *Lumen in the Land of Nanite*: 433 M source triangles become 882 M Nanite triangles
(the hierarchy doubles the count), and that geometry consumes:

| Format                  | Total    | Per Nanite Triangle |
| ----------------------- | -------- | ------------------- |
| Raw (full floats)       | 25.90 GB | 29.4 B              |
| Memory format           | 7.67 GB  | 8.7 B               |
| Compressed memory format| 6.77 GB  | 7.7 B               |
| Disk format             | 4.61 GB  | 5.6 B (their figure)|


That is 11.4 bytes per SOURCE triangle, and "1 M triangles = ~10.9 MB on disk".

How they achieve it, and where we stand:

| Area                 | Reference                                     | WebGeometry                                |
| -------------------- | --------------------------------------------- | ------------------------------------------ |
| Indices              | base + two 5-bit offsets, ~17 bits/tri        | 3 × `u32` = 96 bits/tri (`docs/FORMAT.md`) |
| Indices on disk      | ~5 bits/tri                                   | identical, meshopt compressed              |
| Positions            | quantized to object grid                      | raw floats                                 |
| Normals              | octahedral                                    | raw floats                                 |
| Tangents             | implicit, **0 bits**                          | not stored                                 |
| Vertices, total      | —                                             | ~48 B/tri                                  |

**The verdict: no.** Their memory format stands at 8.7 bytes per triangle, ours at around
50 bytes — a ~6× factor on geometry. The repository target (≤ 12 B/tri, `docs/SPEC_ENGINE_WITHOUT_THREE.md` C5)
is the right order of magnitude; the work to achieve it remains open.

Outside geometry, the gap is wider: 7.56 GB of raw RGBA for Emerald textures, where the reference
maintains a fixed physical pool, compressed at cook time **(3)**.

## 3. Milliseconds — Profile Shape, Not Verdict

Their profile, PS5 demo, average 2496 × 1404 reconstructed to 4K, **25 M rasterized triangles per frame across all scenes**:

| Pass                      | Cost       | WebGeometry Equivalent             |
| ------------------------- | ---------- | ---------------------------------- |
| Clear VisBuffer           | 66 µs      | —                                  |
| Main Pass: InstanceCull   | 108 µs (1) | instance sort                      |
| Main Pass: ClusterCull    | 406 µs     | GPU DAG traversal                  |
| Main Pass: Rasterize      | 1,148 µs   | hardware raster (5)                |
| BuildHZB                  | 99 µs      | Hi-Z pyramid                       |
| Post Pass: InstanceCull   | 125 µs     | — (no second pass yet)             |
| Post Pass: ClusterCull    | 102 µs     | —                                  |
| Post Pass: Rasterize      | 183 µs     | —                                  |
| **Total VisBuffer**       | **~2.5 ms**|                                    |
| DepthExport               | 217 µs     |                                    |
| Emit GBuffer              | 2,084 µs   | material pass                      |
| **Material Pass**         | **~2 ms**  | 1 draw per material                |
| Temporal Antialiasing (4) | unpublished| `WG temporal antialiasing`         |

(1) The slide prints "108ms"; the pass sum and the stated 2.5 ms total indicate microseconds. We record 108 µs.

(4) Their image renders at 2496 × 1404 with jitter and reconstructs to 4K via temporal accumulation;
ours accumulates at native resolution without upsampling, and its pass is read by frame envelope difference.
No isolated cost is published for this pass alone: the line states that both systems implement it.

(5) Their rasterizer is dual: compute for micropolygons, hardware for large triangles. Ours is hardware-only
in production. Hybrid compute/hardware rasterization was tested under the `raster-hybride` diagnostic variant
(matching hardware at 0 px) and proved slower on Apple metal-3, where the hardware pass does not benefit
from compute offloading small triangles. It remains disabled pending measurement on desktop GPUs.

What can be concluded rigorously:

- **CPU cost.** Their figure is "nearly zero CPU time": fully GPU-driven, independent of object count.
  Ours, measured on `emerald-square`, is **0.5 to 2.8 ms per frame** — including cut, dispatch, and residency.
  This metric is comparable across hardware because it is intended to be zero.
- **Draw calls.** Reference: one per material in the deferred pass. Ours: one for the 252 clustered
  opaque primitives, but one per item and face for the 29 primitives declared blended — up to 1,928
  when entering the field of view, causing frame rate drops in grass foliage.
- **GPU milliseconds are inconclusive** until measured on identical hardware. The only rigorous
  comparison requires running the reference and WebGeometry with the same scene, pose, resolution,
  and hardware. Without this, any cross-engine GPU millisecond comparison remains an assumption, which
  the [measurement rules](../CONTRIBUTING.md#measure-before-optimising) strictly prohibit.

## 4. Summary

| | Same Figure? |
| --- | --- |
| DAG and page structure | **Yes**, with the three nuances in §1 |
| Bytes per triangle | **No**: ~6× higher |
| Fixed memory budget | **Yes**: 512 MiB pages and 512 MiB tiles, in bytes, adjustable; textures not yet cook-compressed |
| CPU cost per frame | **No**: 0.5–2.8 ms vs ~0 |
| GPU milliseconds | **Unknown**, pending identical-hardware benchmark campaign |

## Sources

- Brian Karis, Rune Stubbe, Graham Wihlidal, *A Deep Dive into Nanite Virtualized Geometry*, SIGGRAPH
  2021 Advances in Real-Time Rendering in Games —
  <https://advances.realtimerendering.com/s2021/Karis_Nanite_SIGGRAPH_Advances_2021_final.pdf>.
  128-triangle clusters, 8–32 group sizes, fixed page size with pinned root pages, ~17 bits/tri in
  memory and ~5 bits/tri on disk, implicit tangents, performance table and memory summary of
  *Lumen in the Land of Nanite*.
- **(2)** 128 KiB page size: *From Navisworks to Nanite*, thecandidstartup.org —
  <https://www.thecandidstartup.org/2023/04/03/nanite-graphics-pipeline.html>. Default 512 MB streaming
  pool, excluding root pages: `r.Nanite.Streaming.StreamingPoolSize`, Unreal Directive —
  <https://unrealdirective.com/resources/console-variables/r-nanite-streaming-streamingpoolsize/>.
- **(3)** **Unsourced.** The talk describes geometry, not the texture streaming system. The statement in §2
  regarding a cook-compressed fixed texture pool is unsourced here, and `test/integration/reference-ue5.test.mjs`
  does not assert texture pool constants. Pending source validation.
