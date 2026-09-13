# Cache formats 1 and 2 — currently read by the SDK

This is the on-disk contract implemented today. Design documents under [`vision/`](vision/README.md) describe a future virtualized engine; they do not replace this format.

## Namespaces

JavaScript reference and native Rust compilers publish **incompatible** pointers:

| Compiler | Pointer | Payload |
|---|---|---|
| native Rust | `native/<scope>/manifest.json` | `native/<scope>/<key>/clusters.json`, `source.gltf`, `source.bin`, SHA-addressed `native/objects/<digest>.bin` |
| JS reference | `reference/<scope>/manifest.json` | `reference/<scope>/<key>/clusters.json`, `source.gltf`, `source.bin`, per-primitive `pages/*.bin` |

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
- `primitives[]` — `{ mesh, primitive, pass, pages, hierarchy }`
  - `pass` is `exact-clusters` for opaque/MASK geometry, `clustered-blend` for static BLEND geometry, or `shared-blend` for unsplit source geometry (`KHR_materials_transmission` with `transmissionFactor > 0`, skins / `JOINTS_0` / `WEIGHTS_0`, and morph targets).
  - `clusterStrategy` optionally records the effective primitive strategy. Static BLEND always uses `exact-source-order` so exact pages preserve source triangle order even when the asset requests `greedy-adjacency`.
  - `pages[]` — `{ id, url, sha256, bytes, count, min, max }`
  - `hierarchy` — nested replacement regions (leaves hold `page` indices). With QEM, internal nodes also store `errorObject` and `coarsePages`.

Optional fields consumed when present:

- `clusterStrategy` — `exact-source-order` (default) or `greedy-adjacency`
- `simplification` — `true` when coarse QEM pages are included
- `errorModel` — required when the cache includes coarse pages or `hierarchy.errorObject`. Current identity: `qem-local-plus-child-max`. A cache without this field is rejected (`STALE_CACHE`) so a host must recompile; it is not a scene name.
- `pages[].role` — `exact` (default) or `coarse`
- `hierarchy.errorObject` / `hierarchy.coarsePages` / `hierarchy.children` — nested screen-error LOD cut. Selecting a node draws its `coarsePages` and skips children. Omitted fields keep the exact leaves.

Static BLEND geometry receives the same bounded exact pages and nested QEM replacement regions as opaque geometry, but retains its transparent forward pass, original material flags, vertex attributes and source mesh sorting. Exact pages preserve every triangle and its winding in source order. QEM changes indices only; it keeps existing vertices and locks geometry borders. A region that cannot be reduced retains its exact descendants. The positional QEM error does not bound texture-alpha or compositing error: `pixelError=0` is the exact-geometry comparison, and nonzero error settings require a visual check. Transmission remains unsplit because its refraction semantics are separate from alpha blending. These compiler changes create new implementation fingerprints and cache keys; existing `shared-blend` caches remain readable and must be recompiled to gain BLEND clusters.

The current reader explicitly accepts cache formats 1 and 2 and rejects unknown versions. Format 2 is required for `clustered-blend`: older SDK readers reject it instead of treating transparent pages as opaque. Both the pointer and the metadata advertise version 2. Source manifests and historical caches keep version 1; they do not require migration. `FORMAT_VERSION=1` remains the source/base format, while `CLUSTERED_BLEND_FORMAT_VERSION=2` identifies the newer cache semantics. SDK, compiler and cache versions are independent; the compiler fingerprint additionally changes the cache key.

Both compilers validate selected accessors against their own `bufferView` length, including stride and sparse index/value ranges, before publishing a ready pointer. Sparse indices must be strictly increasing and within the accessor count. The JS reference fingerprints the modules it actually executes (source modules in a checkout, built modules in an installed package), its Node adapter, shared default contract and package metadata; it also includes `package-lock.json` when present. The Rust fingerprint includes its source modules, `Cargo.toml` and `Cargo.lock` at build time. Source JSON, declared sidecars, geometry bytes, compilation options and the error-model identity also participate in the cache key. Changes create a new key and leave source assets untouched. External image bytes referred to by URI are not embedded in either cache format or included in this geometry key; hosts own their resource identity.

## Pages

Each page is a tightly packed little-endian `u32` index buffer covering 256 triangles (768 indices) in source order, except the last page of a primitive. The runtime verifies SHA-256 and byte length before attaching a page.

Static opaque, alpha-mask and clustered BLEND primitives can additionally carry `pages[].geometry`: an independently decodable `meshopt` page with `formatVersion: 2`, URL, SHA-256, byte length, vertex/index counts, attribute flags and decoded-byte estimate. This geometry-page version is independent of the outer cache version: the optional field and `autonomousScene` are additive, while `clustered-blend` requires outer cache format 2. An autonomous reader rejects missing or unknown geometry-page versions. The legacy index pages remain available for existing backends.

The geometry-page header is eight little-endian `u32` values: magic `WGP2` (`0x32504757`), version `2`, local vertex count, local index count, attribute flags, vertex stride `72`, compressed index byte count and compressed vertex byte count. The payload contains a meshoptimizer triangle index stream followed by a meshoptimizer vertex stream. Indices are local `u16` values. Vertices contain float32 POSITION, then optional NORMAL, TEXCOORD_0, TANGENT, TEXCOORD_1 and COLOR_0 at fixed offsets; absent attributes occupy zeroed slots. COLOR_0 RGB is extended with alpha 1. The data is lossless at float32 precision; integer normalized glTF attributes are converted to float32 according to glTF normalization before encoding. This does not quantize positions or guarantee a geometric error bound.

When every selected primitive has autonomous pages, both compilers also publish `scene.gltf` and `scene.bin`. This light glTF retains node transforms, material declarations and images but replaces geometry accessors with a dummy triangle; the browser's `autonomousGeometry: true` backend builds real meshes only from verified `.wgpg` pages. It does not request the complete `source.bin` geometry. Embedded images and external textures are still loaded by glTFLoader at preparation time; progressive texture admission and transparent autonomous pages are not implemented. The initial complete root cover is loaded before the explorer becomes ready. `maxResidentPages` counts displayed page instances, while the streamer deduplicates URL transfers; neither limit measures physical VRAM or total application memory.

## Source glTF

The compiler writes a compacted `source.gltf` + `source.bin` for the selected nodes. Relative image URIs are rewritten against the host `resourceBaseUrl`. `images` may be omitted. Images that use `bufferView` (no `uri`) keep their view; the view is copied into `source.bin`. Sparse accessors (`accessor.sparse`) are decoded and their bufferViews are compacted and remapped. Skinned meshes (`skin`, `JOINTS_0`, `WEIGHTS_0`), morph targets (`targets`), and animations are preserved in `source.gltf` and routed to the `shared-blend` reference pass.

## Visibility Buffer Shading

The WebGPU visibility path reconstructs material surfaces, then shades them with its deferred lighting pass. It does not implement specular environment-map IBL or complete glTF material parity. The CPU shading oracle and WGSL path are distinct implementations; exact A/A within one path does not establish parity between them. Compare lossless captures against the Three reference at identical settings before claiming visual fidelity.

## Hi-Z Occlusion Status

The current renderer builds a max-depth pyramid and has occluder and disocclusion passes. CPU and GPU tests choose the first mip whose outward-rounded inclusive footprint fits 16×16 samples; bounds extending outside the target or crossing the near plane are kept. The GPU uses previous-frame page URLs only to choose initial occluders, then tests the remaining pages against this frame's depth. It does not reproject previous-frame depth; the former history buffer copy had no reader and was removed. `applyTemporalHiz` is a CPU reference, not proof of GPU parity. Camera-cut/reveal behavior and GPU pixel/depth/ID parity still require hardware captures before temporal occlusion can be claimed complete.

## Source files

Input is a directory with `manifest.json`, a directory with exactly one `.gltf`/`.glb`, or a `.gltf`/`.glb` file. When `manifest.json` is present, `manifest.runtime.file` names the glTF JSON or GLB. For `.gltf`, the first buffer URI names the sidecar binary. Both names must be a single relative path segment (no `/`, `\\`, or `..`). The compiler verifies SHA-256 of the glTF against `runtime.sha256` and of the sidecar against the matching `runtime.sidecars[]` entry. A GLB carries its BIN chunk; sidecar hashes are not required. Without a manifest, hashes are computed from the files. Multiple glTF buffers are concatenated into one `source.bin` (4-byte padded) and `bufferView.buffer` is remapped to 0. Unknown layouts, data URIs as buffer URIs, and path escape are rejected. Unindexed triangle lists (`POSITION` count a multiple of three, no `indices`) are indexed during clustering. In `slice` scope, if no mesh instance fits the triangle budget, the smallest overflowing instance is kept.
