# Format 1 — cache currently read by the SDK

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

`status` must be `ready`. `url` is resolved relative to the pointer.

## `clusters.json`

Required fields consumed by the browser adapter:

- `schema` / `formatVersion` — must equal `1`
- `status` — `ready`
- `scope` — `slice` or `full`
- `selectedTriangles`, `selectedNodes`
- `primitives[]` — `{ mesh, primitive, pass, pages, hierarchy }`
  - `pass` is `exact-clusters` or `shared-blend` (BLEND materials stay unsplit)
  - `pages[]` — `{ id, url, sha256, bytes, count, min, max }`
  - `hierarchy` — nested replacement regions (leaves hold `page` indices). With QEM, internal nodes also store `errorObject` and `coarsePages`.

Optional fields consumed when present:

- `clusterStrategy` — `exact-source-order` (default) or `greedy-adjacency`
- `simplification` — `true` when coarse QEM pages are included
- `pages[].role` — `exact` (default) or `coarse`
- `hierarchy.errorObject` / `hierarchy.coarsePages` / `hierarchy.children` — nested screen-error LOD cut. Selecting a node draws its `coarsePages` and skips children. Omitted fields keep the exact leaves.

Unknown `formatVersion` values are rejected. `SDK_VERSION`, `FORMAT_VERSION` and the compiler version are independent. The browser still requires format 1; extra fields are additive.

## Pages

Each page is a tightly packed little-endian `u32` index buffer covering 256 triangles (768 indices) in source order, except the last page of a primitive. The runtime verifies SHA-256 and byte length before attaching a page.

## Source glTF

The compiler writes a compacted `source.gltf` + `source.bin` for the selected nodes. Image URIs are rewritten against the host `resourceBaseUrl`.

## Source files

`manifest.runtime.file` names the glTF JSON. The first buffer URI names the sidecar binary. Both names must be a single relative path segment (no `/`, `\\`, or `..`). The compiler verifies SHA-256 of the glTF against `runtime.sha256` and of the binary against the matching `runtime.sidecars[]` entry. Unknown layouts, multiple buffers, data URIs and path escape are rejected.
