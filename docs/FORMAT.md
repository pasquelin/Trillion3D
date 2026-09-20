# Cache formats 1 and 2 — produced and read by the SDK

This is the on-disk contract implemented today. Design documents under

## Layout

| Pointer                        | Payload                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `native/<scope>/manifest.json` | `native/<scope>/<key>/clusters.json`, `clusters.bin`, `source.gltf`, `source.bin`, SHA-addressed objects under `native/objects/`: `<digest>.bin`, one file per index page, geometry page or streaming bundle — and baked texture levels under `native/textures/v<N>/<digest>/<kind>-<level>.png`, one PNG per mip level above the sidecar's tail |

`<scope>` is `slice` or `full`. A pointer or payload with another scope is rejected (`SCOPE_MISMATCH`).

Every served object carries the `.bin` extension and every object name is the SHA-256 of its content. A static file server needs no extension mapping, no MIME configuration and no rule of its own: `application/octet-stream` for `.bin` is what servers already do. The manifest names each object in full, so the extension carries no meaning the reader depends on.

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
- `primitives[]` — `{ mesh, primitive, pass, clusterStrategy, pages, culling, structure, streams, dag, topology }`
  - `pass` is `exact-clusters` for opaque/MASK geometry, `clustered-blend` for static BLEND geometry, or `shared-blend` for unsplit source geometry (`KHR_materials_transmission` with `transmissionFactor > 0`, skins / `JOINTS_0` / `WEIGHTS_0`, and morph targets).
  - `clusterStrategy` is `dag-groups` on every primitive the DAG covers, and `null` on a `shared-blend` primitive, which carries no pages.
  - `errorModel` is `dag-group-qem-v1`, the one model this runtime reads. Every cluster carries its own screen-error band, so nothing walks a tree. A cache whose clusters carry no band — the page tree earlier compilers emitted — is rejected by `assertCacheIdentity` with `STALE_CACHE`, naming the primitive that lacks one, so a host recompiles instead of half-reading a cache.
  - `simplification` is `true` when the compiler ran with `qem-endpoints`.
- `binary` — `{ version, url, sha256, bytes, pageUrl, geometryUrl, bundleUrl }`, the descriptor of the [binary sidecar](#clustersbin). Absent from caches compiled before the sidecar, which carry every array inline; the reader accepts both.

### `clusters.bin`

Per-cluster numbers are the bulk of a manifest: tens of thousands of clusters with a dozen values each. When `binary` is present the compiler writes them as typed-array columns instead, and `clusters.json` keeps only what a human or a tool reads — primitives, materials, passes, reports, and the counts needed to find each primitive's slice of the columns. Emerald Square falls from 48.4 MB of JSON to 387 KB plus a 17.0 MB sidecar, and the reader maps the columns instead of tokenizing them.

The file is little-endian: `u32` magic `WGMB` (`0x424d4757`), `u32` version `6`, `u32` column count `24`, `u32` reserved, then one `(byteOffset, byteLength)` `u32` pair per column, then the payloads, each starting on an 8-byte boundary. Lengths and spheres stay `f64` — they decide a cut, so truncating them would change the image. A digest is stored as its 64 ASCII hexadecimal characters, and an object URL is rebuilt from the `pageUrl` / `geometryUrl` / `bundleUrl` templates by substituting `{sha}` — and a texture level from `textures.url` by substituting `{sha}`, `{kind}` and `{level}` —, which is why no URL is stored at all.

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
- `geometry` — the optional independently decodable geometry page described under [Pages](#pages)

`structure` — `{ version, roots, groups[] }`. `roots` lists the clusters nothing replaces. Each group is `{ level, error, sphere, children, outputs }`, where `children` and `outputs` cover the same surface and are never both drawn.

`culling` — `{ stride, count, nodes }`, a flat BVH over the primitive's clusters. `stride` is 15 numbers per node and node 0 is the root: `min[3]`, `max[3]`, `sphere[4]`, `maxParentError` (`-1` when the subtree holds a cluster with no replacement), `firstChild`, `childCount`, `firstPage`, `pageCount`. A leaf has `childCount` 0. Pages follow the culling order, so every node owns a contiguous page range.

`streams` — `{ version, pinned, bundleBytes, pages[] }`. A bundle is `{ url, sha256, bytes, count }` and groups clusters of one level that the culling order already placed next to each other, targeting 128 KiB. The first `pinned` bundles hold exactly the root clusters, so keeping them resident guarantees a complete, if coarse, cover. Pinned bundles are then concatenated across primitives into shared objects of at most 1 MiB, so a first frame waits on a handful of requests instead of one per primitive; each entry names the shared object and every cluster keeps its own `streamOffset` inside it, unchanged for the reader. A cluster stays individually addressable through its own `url` and through `streamOffset` inside its bundle.

`dag` — a report, not a contract: `{ depth, clusterTriangles, groupMin, groupMax, levels[], groups[], warnings[] }`, where `groups[]` tallies why a group reduced or did not (`reduced`, `tooSmall`, `noCollapse`, `borderLost`, `unusableError`) and how many reductions needed a retry (`welded`: indices welded by position, `relocked`: extra locks to keep the border). `warnings[]` names a DAG that did not climb — `DAG_FLAT` (several clusters, no coarse level) or `DAG_ROOTS` (more than one root per eight pages on a primitive of eight clusters or more) — with `roots`, `pages` and the `groups` tally summed over every level; the compiler also carries it on the primitive's progress event, and the engine reports it as the `dag-warnings` diagnostic when the cache is opened.

Static BLEND geometry joins the DAG on the same terms as opaque geometry but keeps its transparent forward pass, original material flags, vertex attributes and source mesh sorting; `start` restores the source draw order that spatial clustering would otherwise scramble. Simplification changes indices only: it keeps existing vertices and locks every vertex shared with another group, so group borders stay watertight. A group that cannot be reduced keeps its children. The positional error does not bound texture-alpha or compositing error: `pixelError=0` is the exact-geometry comparison, and nonzero error settings require a visual check. Transmission remains unsplit because its refraction semantics are separate from alpha blending.

The current reader explicitly accepts cache formats 1 and 2 and rejects unknown versions. Format 2 is required for `clustered-blend`: older SDK readers reject it instead of treating transparent pages as opaque. Both the pointer and the metadata advertise version 2. Source manifests and historical caches keep version 1; they do not require migration. `FORMAT_VERSION=1` remains the source/base format, while `CLUSTERED_BLEND_FORMAT_VERSION=2` identifies the newer cache semantics. SDK, compiler and cache versions are independent; the compiler fingerprint additionally changes the cache key.

The compiler validates selected accessors against their own `bufferView` length, including stride and sparse index/value ranges, before publishing a ready pointer. Sparse indices must be strictly increasing and within the accessor count. The Rust fingerprint includes its source modules, `Cargo.toml` and `Cargo.lock` at build time. Source JSON, declared sidecars, geometry bytes, compilation options and the error-model identity also participate in the cache key. Changes create a new key and leave source assets untouched. External image bytes referred to by URI are not embedded in the manifest or included in this geometry key — their SHA-256 is, and the baked levels under `native/textures/` are addressed by it; hosts own their resource identity.

## Pages

Each page is a tightly packed little-endian `u32` index buffer covering at most 128 triangles (384 indices) of one DAG cluster. The runtime verifies SHA-256 and byte length before attaching a page. A streaming bundle is the concatenation of those index buffers for the clusters it holds, in the order their `streamOffset` values give.

Static opaque, alpha-mask and clustered BLEND primitives can additionally carry `pages[].geometry`: an independently decodable quantized cluster page with `formatVersion: 3`, `codec: "quantized"`, URL, SHA-256, byte length, vertex/index counts, attribute flags and decoded-byte estimate (`uncompressedBytes`: the page once unpacked to float attributes and 32-bit indices, what the Three-based autonomous backend holds; `bytes` is what a reader that decodes in place keeps resident). This geometry-page version is independent of the outer cache version: the optional field and `autonomousScene` are additive, while `clustered-blend` requires outer cache format 2. A reader rejects a missing or unknown geometry-page version, and a version-6 sidecar names only this page: a sidecar of another version is refused whole rather than page by page. The index pages remain available for existing backends.

#### Quantized cluster page (`WGP3`)

The page is the published cluster format — positions on an object grid, octahedral normals, integer texture coordinates, colours on a grid, bit-packed local indices, no tangent — rebuilt from the literature for the web: twenty-four little-endian `u32` header words, then bit streams that start on a word each, and nothing else. A field never spans more than two words, so a shader reads any vertex or corner of a resident page in place, in O(1), without unpacking it (`clusterDecodeWgsl.ts`); the JavaScript and WebAssembly decoders unpack the same bytes to floats for the autonomous backend.

| Word | Content |
| --- | --- |
| 0, 1 | magic `WGP3` (`0x33504757`), version `3` |
| 2, 3 | vertex count (1 to 65,535), index count (a positive multiple of 3) |
| 4 | attribute flags: `1` NORMAL, `2` TEXCOORD_0, `4` TEXCOORD_1, `8` COLOR_0 |
| 5–8 | position record and minimum: one `f32` per axis |
| 9–11 | TEXCOORD_0 record and minimum |
| 12–14 | TEXCOORD_1 record and minimum |
| 15–19 | COLOR_0 record and minimum, four channels |
| 20 | `f32` quantization error: the largest distance between a source position and its decoded value, in object units |
| 21–23 | reserved, zero |

A record word holds the width of each component in six-bit fields from bit 0 (each 0 to 24) and the grid exponent as a signed byte in the top byte; a component of zero width is constant and has no stream. Streams follow in this order — indices, position `x`, `y`, `z`, normal (if flagged), `u`, `v` of TEXCOORD_0 (if flagged), `u`, `v` of TEXCOORD_1 (if flagged), `r`, `g`, `b`, `a` (if flagged) —, each `ceil(count × bits / 32)` words, each field `i` at bit `i × bits`, least significant bit first. Index fields are `ceil(log2(vertexCount))` bits wide; a normal is 16 bits. Every offset follows from the counts and the widths, so the header stores none and a reader trusts none: the byte length must equal what the streams need, a header field outside the format (a width above 24, an exponent beyond ±64, a non-finite minimum, an unknown flag, a negative error, a reserved word set) refuses the page before any stream is read, and an index at or past the vertex count refuses it before any float is produced.

Decoding is one multiply and one add per component, on 32-bit floats: `value = min + q × 2^exponent`, the product exact because the step is a power of two, the sum rounded once — so the three decoders (`geometryPage.ts` through `Math.fround`, the Rust codec, the WGSL routines) produce the same 32-bit float, which `test/justesse/decodage-cluster-gpu.mjs` proves on the graphics card bit for bit. A normal is two bytes, `x` low and `y` high, `(q × 2/255 − 1)` per byte, the lower hemisphere folded (`z < 0`) then normalized; the constant is the nearest `f32`, written to the digit so every parser reads the same value. The sign of zero is not kept: `-0` lands on the cell of `0`.

The compiler chooses the position grid per primitive, the finer of two rules: `exponent = floor(log2(widest extent)) − 16`, so a primitive spans about 2^16 steps, and `floor(log2(finest group error / 8))`, so a cluster's displacement projects below an eighth of the threshold wherever the cut selects it (the finest group error is the smallest non-zero `lodError` the DAG published). Each cluster then spends only the bits its own box needs; a page whose box would need more than 24 bits per axis coarsens its own exponent, and one that no grid can hold is refused (`INVALID_PAGE_ATTRIBUTE`). Texture coordinates sit on a fixed grid of `2^-14` — a quarter of a texel on a 4096-wide map — and colours, clamped to `[0, 1]`, on `2^-8`, with the same per-page minima and widths: a constant channel costs no bits. The cost is declared, never hidden: word 20 carries the page's worst position displacement, and `primitives[].quantization` — `{ positionExponent, positionStep, uvExponent, maxPositionError }` — carries the primitive's. The cut does not yet add it to a cluster's error (spec C4 remains open); a normal is within 1° of its source, a colour within half a level of 256.

Two source vertices that land on the same cells decode alike, so the page keeps one and remaps its corners: a source that repeats a vertex per corner — Whisperwind's FBX import carries 2.6 vertices per triangle — comes down to its distinct vertices without changing a triangle. Tangents are never written: a shader rebuilds the frame from a triangle's positions and texture coordinates (`clusterTangent`), as the reference does.

When every selected primitive has autonomous pages, the compiler also publishes `scene.gltf` and `scene.bin`. This light glTF retains node transforms, material declarations and images but replaces geometry accessors with a dummy triangle; the browser's `autonomousGeometry: true` backend builds real meshes only from verified geometry pages. It does not request the complete `source.bin` geometry. Embedded images and external textures are loaded by glTFLoader at preparation time unless the host asks for `textureSource: 'cache'`, in which case every image whose chain is baked is replaced by a one-pixel placeholder and its levels are read from the cache on demand; transparent autonomous pages are not implemented. The initial complete root cover is loaded before the explorer becomes ready. `maxResidentPages` counts displayed page instances, while the streamer deduplicates URL transfers; neither limit measures physical VRAM or total application memory.

## Textures

The compiler bakes the **whole mip chain** of every texture an atlas reads — base colour and emissive for the colour atlas, metal-roughness, normal and occlusion for the data atlas — and the engine never decodes a source image again when a host asks for it (`textureSource: 'cache'`). The chain is split in two:

- The **tail**, from the first level no side of which exceeds `PREVIEW_BASE` (64 px) down to 1×1, lives in the sidecar (`clusters.bin`, columns `texturePreviewU32` / `texturePreviewSha` / `texturePreviewPixels`) as raw RGBA8, and is on the card before the first frame. One entry per `(texture, atlas)` pair, twelve `u32` per entry: `texture`, `image`, `width`, `height`, source kind and buffer view, first level, level count, pixel offset and byte length, `atlas` (0 colour, 1 data) and `bakedLevels`. Entries are strictly increasing by `(texture, atlas)`, and a reader recomputes every level's geometry from `width`/`height` instead of trusting the entry.
- The **head**, levels `0` to `bakedLevels - 1`, is one lossless PNG per level at the template `clusters.json` publishes in `textures.url` (`../../textures/v<N>/{sha}/{kind}-{level}.png`, relative to `clusters.json`): `{sha}` is the SHA-256 of the source image bytes, `{kind}` is `srgb` or `linear`, `{level}` the mip rank. Levels are content-addressed, shared by every scene that shares the image, never rewritten once present, and pruned like objects when no surviving manifest names their digest. `v<N>` is `TEXTURE_PREVIEW_VERSION`: a change of the reduction rule changes the path, so stale levels are never served.

Every level, tail and head, follows the rule the card applied when it regenerated the chain itself (`textureMips.ts`): level `k` from the **quantized** level `k - 1`, colours averaged in the atlas's own encoding (sRGB decoded and re-encoded for the colour atlas, linear for the data atlas), alpha the **median** of the four texels, an odd side repeating its last texel. Neither premultiplication nor the file's declared transfer enters it: the pyramid follows the display, not the file. Baking instead of regenerating therefore keeps the image within rounding — measured on Emerald at 2496×1404: 0 pixels beyond ±2 per channel on the general view, and on the lawn view 1 720 isolated pixels (0,05 %) where the median alpha of a coarse texel lands on the other side of the 0,5 cutoff, plus their shadows when the sun is on.

An image whose decode fails has no entry: its textures load from the source as before. A texture whose chain is not whole (`bakedLevels < firstLevel`) also keeps the source path.

## Source glTF

The compiler writes a compacted `source.gltf` + `source.bin` for the selected nodes. Relative image URIs are rewritten against the host `resourceBaseUrl`. `images` may be omitted. Images that use `bufferView` (no `uri`) keep their view; the view is copied into `source.bin`. Sparse accessors (`accessor.sparse`) are decoded and their bufferViews are compacted and remapped. Skinned meshes (`skin`, `JOINTS_0`, `WEIGHTS_0`), morph targets (`targets`), and animations are preserved in `source.gltf` and routed to the `shared-blend` reference pass.

## Visibility Buffer Shading

The WebGPU visibility path reconstructs material surfaces, then shades them with its deferred lighting pass. It does not implement specular environment-map IBL or complete glTF material parity. The CPU shading oracle and WGSL path are distinct implementations; exact A/A within one path does not establish parity between them. Compare lossless captures against the Three reference at identical settings before claiming visual fidelity.

## Hi-Z Occlusion Status

The WebGPU renderer runs the published two-phase occlusion design. The main pass draws the rows the previous frame drew that the previous frame's pyramid does not hide — each row's previous-frame rectangle and depth bound are read against that pyramid on the GPU, no reprojection — then a pyramid of farthest depths (reverse-Z minimum) is built from that depth, and the post pass tests the withdrawn and previously rejected rows against it before drawing what survives. CPU and GPU tests choose the first mip whose outward-rounded inclusive footprint fits 16×16 samples; bounds extending outside the target or crossing the near plane are kept. The previous frame's pyramid only chooses the main pass; the current frame's pyramid is the only judge of what is rejected, and it is conservative to the ulp (`test/browser/partition-gpu-conservatrice.browser.mjs`). A row kept by the test while the view stands still remains in the main pass until the view or a world moves, so a still image converges under the antialiasing jitter and is held. `applyTemporalHiz` is the CPU reference of the WebGL2 path, not proof of GPU parity.

## Source files

Input is a directory with `manifest.json`, a directory with exactly one `.gltf`/`.glb`, or a `.gltf`/`.glb` file. When `manifest.json` is present, `manifest.runtime.file` names the glTF JSON or GLB. For `.gltf`, the first buffer URI names the sidecar binary. Both names must be a single relative path segment (no `/`, `\\`, or `..`). The compiler verifies SHA-256 of the glTF against `runtime.sha256` and of the sidecar against the matching `runtime.sidecars[]` entry. A GLB carries its BIN chunk; sidecar hashes are not required. Without a manifest, hashes are computed from the files. Multiple glTF buffers are concatenated into one `source.bin` (4-byte padded) and `bufferView.buffer` is remapped to 0. Unknown layouts, data URIs as buffer URIs, and path escape are rejected. Unindexed triangle lists (`POSITION` count a multiple of three, no `indices`) are indexed during clustering. In `slice` scope, if no mesh instance fits the triangle budget, the smallest overflowing instance is kept.
