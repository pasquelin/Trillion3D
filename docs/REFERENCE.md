# The Reference in Numbers

What the reference publishes against what this repository holds, to answer "do we have the same
numbers as they do, on the web" without assumptions or fabricated metrics. Three categories, each
compared differently:

1. **Structural constants** compare directly: format numbers, not measurements;
   `tests/integration/reference.test.ts` fails on every `pnpm test` where one diverges from §1.
2. **Bytes per triangle** compare per triangle, never per scene: the reference scene is not ours.
3. **Milliseconds do not compare directly**: their profile comes from a console demo, ours from a
   laptop GPU, and none of the five conditions the [contribution guidelines](../CONTRIBUTING.md)
   require (input, camera, quality, machine, budget) match. They are listed for profile SHAPE — what
   pass costs what — and for the one figure that crosses hardware: per-frame CPU cost.

All "reference" values come from the SIGGRAPH 2021 talk _A Deep Dive into Nanite Virtualized
Geometry_ (Karis, Stubbe, Wihlidal), except two lines marked **(2)** (secondary source) and one
sentence marked **(3)** (unsourced). Only published figures are used: no reference code, shader or
asset is read, quoted or ported.

## 1. Structure — Verified by Automated Tests

| Metric | Reference | Trillion3D | Evidence |
| --- | --- | --- | --- |
| Triangles per cluster | 128 | 128 | `dag.rs:DAG_CLUSTER_TRIANGLES` |
| Vertices per cluster | — | 255 | `dag.rs:DAG_CLUSTER_VERTICES` |
| Clusters per group, floor | 8 | 8 | `dag.rs:DAG_GROUP_MIN` |
| Clusters per group, ceiling | 32 | 32 | `dag.rs:DAG_GROUP_MAX` |
| Streaming bundle / page | 128 KiB (2) | 128 KiB | `lib.rs:STREAM_BUNDLE_BYTES` |
| Bootstrap object | — | 1 MiB | `lib.rs:BOOTSTRAP_BUNDLE_BYTES` |

Two nuances not visible in the table:

- **Group floor is not enforced.** `dag/groups.rs` splits when a group exceeds `DAG_GROUP_MAX` but
  does not enforce `DAG_GROUP_MIN`: a group of 2 clusters is accepted where the reference requires
  8.
- **Residency budget is counted in bytes, as the reference's** — a fixed 512 MB by default,
  excluding root pages, which are always resident **(2)**. Ours: `geometryPoolBytes`, 512 MiB
  default, converted to slots sized to the largest page, never below root coverage (`pinned`,
  `docs/FORMAT.md`). Two differences in our favour: an in-session change keeps what fits the new
  pool where the reference flushes, and a full pool is a counter (`geometryPoolSaturated`) and a
  coarser cut, not an exception or a log warning.

## 2. Bytes per Triangle — The Sole Valid Memory Comparison

The reference on _Lumen in the Land of Nanite_: 433 M source triangles become 882 M Nanite triangles
(the hierarchy doubles the count), and that geometry consumes:

| Format | Total | Per Nanite Triangle |
| --- | --- | --- |
| Raw (full floats) | 25.90 GB | 29.4 B |
| Memory format | 7.67 GB | 8.7 B |
| Compressed memory format | 6.77 GB | 7.7 B |
| Disk format | 4.61 GB | 5.6 B (their figure) |

That is 11.4 bytes per SOURCE triangle, and "1 M triangles = ~10.9 MB on disk".

How they achieve it, and where we stand:

| Area | Reference | Trillion3D |
| --- | --- | --- |
| Indices | base + two 5-bit offsets, ~17 bits/tri | index pages: 3 × `u32` = 96 bits/tri (`docs/FORMAT.md`); geometry pages: local indices delta-coded in blocks |
| Indices on disk | ~5 bits/tri | identical, meshopt compressed |
| Positions | quantized to object grid | quantized to the primitive's object grid in geometry pages (`WGP3`, `docs/FORMAT.md`); floats in `source.bin` |
| Normals | octahedral | octahedral in geometry pages; floats in `source.bin` |
| Tangents | implicit, **0 bits** | not stored |
| Vertices, total | — | ~48 B/tri (float vertices; a cache's page figures: `bench/runner/bytesPerTriangle.ts`) |

**The verdict: no.** Their memory format stands at 8.7 bytes per triangle, ours at around 50 bytes
with float vertices and `u32` index pages — a ~6× factor on geometry. The repository target of at
most 12 bytes per triangle is the right order of magnitude; the work to achieve it remains open.

Outside geometry, the gap has narrowed in kind: Emerald's textures, 7.56 GB of raw RGBA, are baked
block-compressed at cook time — BC7 and BC5 on desktop, ASTC 4×4 on mobile, one byte per texel — and
served from fixed physical pools, one per format lane as the reference's virtual-texture physical
spaces are understood to be **(3)**; unlike the reference, a chain is kept in blocks only under a
quality gate (48 dB, 3 levels of 255 on a texel, no mask flip), so on Emerald 100 of 336 chains (30
%) are in BC blocks — none of the colour atlas's texels, a third of the data atlas's — and the rest
stays lossless: the reference's whole-catalogue compression is not reached, by the rule that the
image must not move.

## 3. Milliseconds — Profile Shape, Not Verdict

Their profile, PS5 demo, average 2496 × 1404 reconstructed to 4K, **25 M rasterized triangles per
frame across all scenes**:

| Pass | Cost | Trillion3D Equivalent |
| --- | --- | --- |
| Clear VisBuffer | 66 µs | — |
| Main Pass: InstanceCull | 108 µs (1) | instance sort |
| Main Pass: ClusterCull | 406 µs | GPU DAG traversal, last-image pyramid cull (`projectRows`) |
| Main Pass: Rasterize | 1,148 µs | hardware raster (5) |
| BuildHZB | 99 µs | Hi-Z pyramid |
| Post Pass: InstanceCull | 125 µs | — (no instance level: rows are clusters) |
| Post Pass: ClusterCull | 102 µs | Hi-Z test of the withdrawn and rejected rows (`Trillion3D HiZ test`) |
| Post Pass: Rasterize | 183 µs | `Trillion3D visibility secondary` |
| **Total VisBuffer** | **~2.5 ms** |  |
| DepthExport | 217 µs |  |
| Emit GBuffer | 2,084 µs | material pass |
| **Material Pass** | **~2 ms** | material depth, 1 draw per class |
| Temporal Antialiasing (4) | unpublished | `Trillion3D temporal antialiasing` |

(1) The slide prints "108ms"; the pass sum and the stated 2.5 ms total indicate microseconds: 108
µs.

(4) Their image renders at 2496 × 1404 with jitter and reconstructs to 4K by temporal accumulation;
ours does the same below the display, the frame budget choosing the scale between 0.5 and 1 per axis
(`renderScale`, docs/ENGINE.md "Render scale"), a still image drawn at native resolution; its pass
is read by frame envelope difference. No isolated cost is published: the line says both implement
it.

(5) Their rasterizer is dual: compute for micropolygons, hardware for large triangles. Ours is
hardware-only in production: the hybrid, tested as the `raster-hybrid` diagnostic variant (0 px
against hardware), was slower on Apple metal-3, whose hardware pass gains nothing from compute
taking small triangles; it stays off pending measurement on desktop GPUs.

What can be concluded rigorously:

The CPU and draw-call figures below were read on the ten-million-triangle interior the bench used
before 22 Sept. 2026, a private scene no longer on any machine: historical, not reproducible.

- **CPU cost.** Theirs is "nearly zero CPU time": fully GPU-driven, independent of object count.
  Ours: **0.5 to 2.8 ms per frame**, cut, dispatch and residency included — comparable across
  hardware because it is meant to be zero.
- **Draw calls.** Reference: one per material in the deferred pass. Ours: one for the 252 clustered
  opaque primitives, but one per item and face for the 29 primitives declared blended — up to 1,928
  when entering the field of view, dropping frames in grass foliage.
- **GPU milliseconds are inconclusive** until the reference and Trillion3D run the same scene, pose,
  resolution and hardware; anything else is an assumption the [measurement
  rules](../CONTRIBUTING.md#measure-before-optimising) prohibit.

## 4. Summary

|  | Same Figure? |
| --- | --- |
| DAG and page structure | **Yes**, with the two nuances in §1 |
| Bytes per triangle | **No**: ~6× higher |
| Fixed memory budget | **Yes**: 512 MiB pages and 512 MiB tiles, in bytes, adjustable; textures cook-compressed under a quality gate (BC7/BC5, ASTC 4×4, #45) |
| CPU cost per frame | **No**: 0.5–2.8 ms vs ~0 |
| GPU milliseconds | **Unknown**, pending an identical-hardware campaign |

## Sources

- Brian Karis, Rune Stubbe, Graham Wihlidal, _A Deep Dive into Nanite Virtualized Geometry_,
  SIGGRAPH 2021 Advances in Real-Time Rendering in Games —
  <https://advances.realtimerendering.com/s2021/Karis_Nanite_SIGGRAPH_Advances_2021_final.pdf>.
  128-triangle clusters, 8–32 group sizes, fixed page size with pinned root pages, ~17 bits/tri in
  memory and ~5 bits/tri on disk, implicit tangents, performance table and memory summary of _Lumen
  in the Land of Nanite_.
- **(2)** 128 KiB page size: _From Navisworks to Nanite_, thecandidstartup.org —
  <https://www.thecandidstartup.org/2023/04/03/nanite-graphics-pipeline.html>. Default 512 MB streaming
  pool, excluding root pages: `r.Nanite.Streaming.StreamingPoolSize`, Unreal Directive —
  <https://unrealdirective.com/resources/console-variables/r-nanite-streaming-streamingpoolsize/>.
- **(3)** **Unsourced.** The talk describes geometry, not texture streaming: §2's statement on a
  cook-compressed fixed texture pool is unsourced here, pending a source, and
  `tests/integration/reference.test.ts` asserts no texture pool constant.
