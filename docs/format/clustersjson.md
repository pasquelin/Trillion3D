# `clusters.json`

The manifest as a page tree: fixed-size root, a head page with every other field, and mesh pages of
slim primitives, each page with its column file.

- Versions: the cache format; `DAG_ERROR_MODEL` (`rust/lib.rs`, `core/contracts/base.ts`).
- Writes `rust/compiler/pages/manifest.rs:write_manifest`.
- Reads `core/contracts/cache.ts:assertCacheRoot`, `core/manifest/paged.ts:readPagedManifest`,
  `core/contracts/cache.ts:assertCacheIdentity`; types `core/contracts/geometry.ts:ClusterManifest`.

## Column files

`manifest-page-<sha256>.bin`: per-cluster numbers as typed-array columns, mapped, not parsed.

- Version: `MANIFEST_BINARY_VERSION` 23 (22 and 21 still read), 28 columns in `COLUMN_NAMES` order, with
  the `texturePreviewBc7`, `texturePreviewAstc` and `texturePreviewEtc2` block columns
  (`rust/manifest_binary.rs`, `core/manifest/binaryFormat.ts`). Per version:
  - 23 appends `bundleDecodedBytes`: a compressed bundle's inflated bytes, else 0
    ([Pages](pages.md#pages)).
  - 22 empties the head's pixel column; RGBA8 tails are their own file
    ([Textures](textures.md#textures)).
  - 20: `WGP3` format 12, up to eight texture sets ([Pages](pages.md#pages)).
  - 19 widens the `geometryU32` record from five words to seven: bytes on disk, vertex count, index
    count, flags, decoded bytes, bytes in the pool once installed, offset in its streaming page's
    place; `WGP3` format 11.
  - 18 drops the page normal-cone column (the last).
  - 17: `WGP3` format 9; culling boxes bound decoded positions.
  - 16: clusters in streaming-page fill order; `cullingNodes` is `CULLING_STRIDE` (16) numbers a node.
  - 15: clusters assigned to streaming pages ([Cluster DAG](#cluster-dag)); `stream` and
    `streamOffset` columns and dependency lists.
  - 14: a pinned bundle holds the DAG's whole root page.
  - 13: clusters partitioned by the triangles' graph (`codec/partition.rs`); geometry pages in
    streaming bundles: a bundle names its file by rank in `geometryFiles`, offset
    and digest; `pageSha`, `geometrySha` gone.
  - 12: one clusterer (`codec/clusters.rs`), one culling-tree builder (`codec/culling.rs`).
- Writes `rust/manifest_binary.rs:Encoded`; reads `core/manifest/binaryRead.ts:readManifestColumns`,
  `core/manifest/binaryDecode.ts:decodeManifestBinary`.

## Cluster DAG

Per primitive: clusters, the groups replacing them level by level, a culling tree and STREAMING PAGES
(bundles of `streams.pages`; the unit read, installed, kept and dropped; one geometry pool slot each)
whose dependencies close up to the root pages.

Page assignment (`rust/compiler/pages/bundles.rs:assign_pages`):
- Walk groups coarsest to finest (roots first, as one group); within a level by Morton code of the LOD
  balls' centres on a 1024-cell grid along the box's longest side, bits flipped on an odd level
  (`bundles/order.rs`); a group's clusters along the diagonal of their balls.
- A cluster fills the current page while it holds its resident bytes ([Pages](pages.md#pages)) and one
  more cluster, else a new page.
- First pages are ROOT PAGES (`streams.pinned` counts them): 32 KiB and 64 clusters at most
  (`ROOT_PAGE_BYTES`, `ROOT_PAGE_CLUSTERS`), as many as the mesh's `alwaysResidentKib` fills
  ([COMPILER.md](../compiler/how-a-mesh-coarsens.md#mesh-build-settings)), one at least, up to the last
  page holding a root. Others: 128 KiB and 256 clusters at most (`STREAM_BUNDLE_BYTES`,
  `STREAM_PAGE_CLUSTERS`). A cluster page past a streaming page's bytes is refused
  (`CLUSTER_PAGE_TOO_LARGE`).
- A page lists every page of each group holding one of its clusters' outputs (root pages for one
  nothing replaces; `rust/compiler/pages/dependencies.rs`), closed transitively; a root page lists root
  pages only. A session keeps every cluster of a root page and of a page holding a root
  (`browser/frame/prepare/rootCover.ts`, `PageRec.pinned`).

Cluster RANKS (named by `pages`, `structure`, the culling tree) are page-fill order. CULLING TREE
(`primitives[].culling`, `CULLING_STRIDE` 16 numbers a node: box min and max, LOD ball, replacement
error ceiling (-1 over a subtree holding a root), least own error, first child, child count, first
page, page count): one leaf per GROUP PART (ranks of one group one page holds; a root is its own part)
with its clusters' box, its group's LOD ball and replacement error, the least own error. Each level's
parts get their own tree, four children a node (`CULLING_FANOUT`), sorted at each binary split along
the axis whose two sides' boxes have the least summed surface; the three coarsest levels' roots and a
tree of the others hang under the root. Inner node: children's box, ball of their balls, least own
error, largest ceiling below; children side by side after it (`rust/compiler/hierarchy.rs`,
`codec/culling/tree.rs`).

Simplified cooks differ from earlier ones in coarse pages (`objects/*.bin`, `world-roots.dag`,
`WORLD_ROOTS_VERSION`): source-vertex positions are kept bit for bit (`rust/simplify/region.rs`).

- Types: `core/contracts/geometry.ts` (`Page`, `ClusterStructure`, `StreamCatalogue`); the cut,
  `browser/geometry/cut/rule.ts:drawsCluster`.
- Writes `rust/dag.rs`, `rust/compiler/pages/bundles.rs:assign_pages`,
  `rust/compiler/pages/dependencies.rs`; culling tree `codec/culling.rs:build_culling_bvh` (primitive's,
  world's (`world-roots.dag`) and run-time cut's hierarchy).
