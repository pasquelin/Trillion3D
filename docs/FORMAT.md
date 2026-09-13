# Cache formats 1 and 2 — produced and read by the SDK

This is the on-disk contract implemented today. Design documents under [`vision/`](vision/README.md) describe a future virtualized engine; they do not replace this format.

## Layout

| Pointer | Payload |
|---|---|
| `native/<scope>/manifest.json` | `native/<scope>/<key>/clusters.json`, `clusters.bin`, `source.gltf`, `source.bin`, and SHA-addressed objects under `native/objects/`: `<digest>.bin` index pages, `<digest>.wgpg` geometry pages, `<digest>.wgsb` streaming bundles |

`<scope>` is `slice` or `full`. A pointer or payload with another scope is rejected (`SCOPE_MISMATCH`).

## Pointer

```json
{
  "status": "ready",
  "formatVersion": 1,
  "compiler": "native-rust",
  "key": "<cache-key>",
  "scope": "slice",
  "url": "<key>/clusters.json"
}
```

`status` must be `ready`. `url` is resolved relative to the pointer. A cache containing `clustered-blend` uses `formatVersion: 2` in both this pointer and its metadata. Other caches remain format 1.

## `clusters.json`

Required fields consumed by the browser adapter:

- `schema` / `formatVersion` — must agree: `2` when the cache contains `clustered-blend`, otherwise `1`
- `status` — `ready`
- `scope` — `slice` or `full`
- `selectedTriangles`, `selectedNodes`
- `primitives[]` — `{ mesh, primitive, pass, clusterStrategy, pages, hierarchy, culling, structure, streams, dag, topology }`
  - `pass` is `exact-clusters` for opaque/MASK geometry, `clustered-blend` for static BLEND geometry, or `shared-blend` for unsplit source geometry (`KHR_materials_transmission` with `transmissionFactor > 0`, skins / `JOINTS_0` / `WEIGHTS_0`, and morph targets).
  - `clusterStrategy` is `dag-groups` on every primitive the DAG covers, and `null` on a `shared-blend` primitive, which carries no pages.
  - `hierarchy` is `null`. A cluster that carries its own screen-error band needs no tree; the reader still accepts the pair-tree hierarchy of caches compiled before the DAG.
  - `errorModel` is `dag-group-qem-v1`. A cache with coarse pages and no error model is rejected (`STALE_CACHE`) so a host recompiles; `bounds-diagonal-boundary-v1` identifies the older pair-tree model, which the reader still accepts and the compiler no longer produces.
  - `simplification` is `true` when the compiler ran with `qem-endpoints`.
- `binary` — `{ version, url, sha256, bytes, pageUrl, geometryUrl, bundleUrl }`, the descriptor of the [binary sidecar](#clustersbin). Absent from caches compiled before the sidecar, which carry every array inline; the reader accepts both.

### `clusters.bin`

Per-cluster numbers are the bulk of a manifest: tens of thousands of clusters with a dozen values each. When `binary` is present the compiler writes them as typed-array columns instead, and `clusters.json` keeps only what a human or a tool reads — primitives, materials, passes, reports, and the counts needed to find each primitive's slice of the columns. Emerald Square falls from 48.4 MB of JSON to 387 KB plus a 17.0 MB sidecar, and the reader maps the columns instead of tokenizing them.

The file is little-endian: `u32` magic `WGMB` (`0x424d4757`), `u32` version `1`, `u32` column count `20`, `u32` reserved, then one `(byteOffset, byteLength)` `u32` pair per column, then the payloads, each starting on an 8-byte boundary. Lengths and spheres stay `f64` — they decide a cut, so truncating them would change the image. A digest is stored as its 64 ASCII hexadecimal characters, and an object URL is rebuilt from the `pageUrl` / `geometryUrl` / `bundleUrl` templates by substituting `{sha}`, which is why no URL is stored at all.

Indices inside a column stay local to the primitive: a group names the pages of its primitive, a page names the bundle of its primitive. Each primitive declares only its own counts in `primitives[].binary` — `pages`, and the `culling`, `structure` and `streams` counts — and the reader derives its base offsets by prefix sum, so the small JSON carries no offset to maintain. A reader refuses a missing magic, an unknown version, a different column count, a column out of bounds, a column whose length contradicts the declared counts, or a file whose size does not match `bytes`; it refuses the version before fetching the columns.

### Cluster DAG

Level 0 partitions the source triangles into clusters of at most 128 triangles, each covering its triangles exactly once and in a spatial order. Every level after that groups 8 to 32 neighbouring clusters, simplifies the merged group with the vertices it shares with another group locked, and re-splits the result into clusters of the same size. A runtime picks a cut: draw cluster `c` when `parentError > threshold >= lodError`, which covers the surface exactly once because coarsening is a group-wide swap.

`pages[]` entries carry, in addition to `{ id, url, sha256, bytes, count, min, max }`:

- `role` — `exact` at level 0, `coarse` above it
- `level` — DAG level, 0 for the source triangles
- `lodError` / `sphere` — object-space error of the group that produced this cluster, and the `[x, y, z, radius]` sphere it is projected through
- `parentError` / `parentSphere` — the same pair for the group that replaces this cluster; both `null` on a root, which is never replaced
- `group` — index in `structure.groups` of the group that replaces this cluster, `null` on a root
- `source` — index of the group that produced it, `null` at level 0
- `start` — offset of the earliest source index this cluster descends from, which restores a transparent draw order
- `stream` / `streamOffset` — streaming bundle holding this cluster and its byte offset inside it
- `geometry` — the optional independently decodable `.wgpg` page described under [Pages](#pages)

`structure` — `{ version, roots, groups[] }`. `roots` lists the clusters nothing replaces. Each group is `{ level, error, sphere, children, outputs }`, where `children` and `outputs` cover the same surface and are never both drawn.

`culling` — `{ stride, count, nodes }`, a flat BVH over the primitive's clusters. `stride` is 15 numbers per node and node 0 is the root: `min[3]`, `max[3]`, `sphere[4]`, `maxParentError` (`-1` when the subtree holds a cluster with no replacement), `firstChild`, `childCount`, `firstPage`, `pageCount`. A leaf has `childCount` 0. Pages follow the culling order, so every node owns a contiguous page range.

`streams` — `{ version, pinned, bundleBytes, pages[] }`. A bundle is `{ url, sha256, bytes, count }` and groups clusters of one level that the culling order already placed next to each other, targeting 128 KiB. The first `pinned` bundles hold exactly the root clusters, so keeping them resident guarantees a complete, if coarse, cover. Pinned bundles are then concatenated across primitives into shared objects of at most 1 MiB, so a first frame waits on a handful of requests instead of one per primitive; each entry names the shared object and every cluster keeps its own `streamOffset` inside it, unchanged for the reader. A cluster stays individually addressable through its own `url` and through `streamOffset` inside its bundle.

`dag` — a report, not a contract: `{ depth, clusterTriangles, groupMin, groupMax, levels[], groups[] }`, where `groups[]` tallies why a group reduced or did not (`reduced`, `tooSmall`, `noCollapse`, `borderLost`, `unusableError`).

Static BLEND geometry joins the DAG on the same terms as opaque geometry but keeps its transparent forward pass, original material flags, vertex attributes and source mesh sorting; `start` restores the source draw order that spatial clustering would otherwise scramble. Simplification changes indices only: it keeps existing vertices and locks every vertex shared with another group, so group borders stay watertight. A group that cannot be reduced keeps its children. The positional error does not bound texture-alpha or compositing error: `pixelError=0` is the exact-geometry comparison, and nonzero error settings require a visual check. Transmission remains unsplit because its refraction semantics are separate from alpha blending.

The current reader explicitly accepts cache formats 1 and 2 and rejects unknown versions. Format 2 is required for `clustered-blend`: older SDK readers reject it instead of treating transparent pages as opaque. Both the pointer and the metadata advertise version 2. Source manifests and historical caches keep version 1; they do not require migration. `FORMAT_VERSION=1` remains the source/base format, while `CLUSTERED_BLEND_FORMAT_VERSION=2` identifies the newer cache semantics. SDK, compiler and cache versions are independent; the compiler fingerprint additionally changes the cache key.

The compiler validates selected accessors against their own `bufferView` length, including stride and sparse index/value ranges, before publishing a ready pointer. Sparse indices must be strictly increasing and within the accessor count. The Rust fingerprint includes its source modules, `Cargo.toml` and `Cargo.lock` at build time. Source JSON, declared sidecars, geometry bytes, compilation options and the error-model identity also participate in the cache key. Changes create a new key and leave source assets untouched. External image bytes referred to by URI are not embedded in either cache format or included in this geometry key; hosts own their resource identity.

## Pages

Each page is a tightly packed little-endian `u32` index buffer covering at most 128 triangles (384 indices) of one DAG cluster. The runtime verifies SHA-256 and byte length before attaching a page. A `.wgsb` streaming bundle is the concatenation of those index buffers for the clusters it holds, in the order their `streamOffset` values give.

Static opaque, alpha-mask and clustered BLEND primitives can additionally carry `pages[].geometry`: an independently decodable `meshopt` page with `formatVersion: 2`, URL, SHA-256, byte length, vertex/index counts, attribute flags and decoded-byte estimate. This geometry-page version is independent of the outer cache version: the optional field and `autonomousScene` are additive, while `clustered-blend` requires outer cache format 2. An autonomous reader rejects missing or unknown geometry-page versions. The legacy index pages remain available for existing backends.

The geometry-page header is eight little-endian `u32` values: magic `WGP2` (`0x32504757`), version `2`, local vertex count, local index count, attribute flags, vertex stride `72`, compressed index byte count and compressed vertex byte count. The payload contains a meshoptimizer triangle index stream followed by a meshoptimizer vertex stream. Indices are local `u16` values. Vertices contain float32 POSITION, then optional NORMAL, TEXCOORD_0, TANGENT, TEXCOORD_1 and COLOR_0 at fixed offsets; absent attributes occupy zeroed slots. COLOR_0 RGB is extended with alpha 1. The data is lossless at float32 precision; integer normalized glTF attributes are converted to float32 according to glTF normalization before encoding. This does not quantize positions or guarantee a geometric error bound.

When every selected primitive has autonomous pages, the compiler also publishes `scene.gltf` and `scene.bin`. This light glTF retains node transforms, material declarations and images but replaces geometry accessors with a dummy triangle; the browser's `autonomousGeometry: true` backend builds real meshes only from verified `.wgpg` pages. It does not request the complete `source.bin` geometry. Embedded images and external textures are still loaded by glTFLoader at preparation time; progressive texture admission and transparent autonomous pages are not implemented. The initial complete root cover is loaded before the explorer becomes ready. `maxResidentPages` counts displayed page instances, while the streamer deduplicates URL transfers; neither limit measures physical VRAM or total application memory.

## Source glTF

The compiler writes a compacted `source.gltf` + `source.bin` for the selected nodes. Relative image URIs are rewritten against the host `resourceBaseUrl`. `images` may be omitted. Images that use `bufferView` (no `uri`) keep their view; the view is copied into `source.bin`. Sparse accessors (`accessor.sparse`) are decoded and their bufferViews are compacted and remapped. Skinned meshes (`skin`, `JOINTS_0`, `WEIGHTS_0`), morph targets (`targets`), and animations are preserved in `source.gltf` and routed to the `shared-blend` reference pass.

## Visibility Buffer Shading

The WebGPU visibility path reconstructs material surfaces, then shades them with its deferred lighting pass. It does not implement specular environment-map IBL or complete glTF material parity. The CPU shading oracle and WGSL path are distinct implementations; exact A/A within one path does not establish parity between them. Compare lossless captures against the Three reference at identical settings before claiming visual fidelity.

## Hi-Z Occlusion Status

The current renderer builds a max-depth pyramid and has occluder and disocclusion passes. CPU and GPU tests choose the first mip whose outward-rounded inclusive footprint fits 16×16 samples; bounds extending outside the target or crossing the near plane are kept. The GPU uses previous-frame page URLs only to choose initial occluders, then tests the remaining pages against this frame's depth. It does not reproject previous-frame depth; the former history buffer copy had no reader and was removed. `applyTemporalHiz` is a CPU reference, not proof of GPU parity. Camera-cut/reveal behavior and GPU pixel/depth/ID parity still require hardware captures before temporal occlusion can be claimed complete.

## Source files

Input is a directory with `manifest.json`, a directory with exactly one `.gltf`/`.glb`, or a `.gltf`/`.glb` file. When `manifest.json` is present, `manifest.runtime.file` names the glTF JSON or GLB. For `.gltf`, the first buffer URI names the sidecar binary. Both names must be a single relative path segment (no `/`, `\\`, or `..`). The compiler verifies SHA-256 of the glTF against `runtime.sha256` and of the sidecar against the matching `runtime.sidecars[]` entry. A GLB carries its BIN chunk; sidecar hashes are not required. Without a manifest, hashes are computed from the files. Multiple glTF buffers are concatenated into one `source.bin` (4-byte padded) and `bufferView.buffer` is remapped to 0. Unknown layouts, data URIs as buffer URIs, and path escape are rejected. Unindexed triangle lists (`POSITION` count a multiple of three, no `indices`) are indexed during clustering. In `slice` scope, if no mesh instance fits the triangle budget, the smallest overflowing instance is kept.
