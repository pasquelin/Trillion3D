# `clusters.json`

The manifest as a page tree: a fixed-size root, a head page with every other field, and mesh pages
of slim primitives, each page with its column file. No run measure is written: a rebuild writes the
same bytes.

- Versions: the cache format; `DAG_ERROR_MODEL` (`rust/lib.rs`, `core/contracts/base.ts`).
- Writes `rust/compiler/pages/manifest.rs:write_manifest`.
- Reads `core/contracts/cache.ts:assertCacheRoot`, `core/manifest/paged.ts:readPagedManifest`,
  `core/contracts/cache.ts:assertCacheIdentity`; types `core/contracts/geometry.ts:ClusterManifest`.

## Column files

`manifest-page-<sha256>.bin`: per-cluster numbers as typed-array columns, mapped, not parsed.

- Version: `MANIFEST_BINARY_VERSION` 23 (22 and 21 still read), 28 columns in `COLUMN_NAMES` order, with the
  `texturePreviewBc7`, `texturePreviewAstc` and `texturePreviewEtc2` block columns
  (`rust/manifest_binary.rs`, `core/manifest/binaryFormat.ts`). 23 appends the `bundleDecodedBytes`
  column, a streaming bundle's bytes once inflated when it is stored compressed, 0 otherwise
  ([Pages](pages.md#pages)); read as a 22, a compressed bundle's stored bytes would be decoded as its
  pages. 22 empties the head's pixel column: the
  previews' RGBA8 tails are their own file ([Textures](textures.md#textures)). 20 keeps every column: the pages are
  the `WGP3` format 12, which carries up to eight texture sets ([Pages](pages.md#pages)). 19 widens a geometry page's record,
  the `geometryU32` column, from five words to seven — its bytes on disk, vertex count, index count,
  flags and decoded bytes, then the bytes it takes in the pool once installed and its offset in its
  streaming page's place there ([Pages](pages.md#pages)) — and its pages are the `WGP3` format 11: a 18
  reader would stride through the records wrongly. 18 drops the page normal-cone
  column, the last, which the runtime read none of: a 17 reader would expect 28 columns. 17 keeps
  every column: the pages are then the `WGP3` format 9 ([Pages](pages.md#pages); format 11 from 19), and the culling boxes bound the
  positions the pages decode to, so the pages, the box columns and the page sizes differ from a 16
  cook's; no record carries a quantization error any more. 16 lays the clusters in the order
  their streaming pages are filled in, and the `cullingNodes` column holds `CULLING_STRIDE` (16)
  numbers a node, the least own error beside the ceiling, the tree's leaves the group parts
  ([Cluster DAG](#cluster-dag)): a 15 reader would read the nodes off their stride. 15 keeps every column: the
  clusters are assigned to streaming pages ([Cluster DAG](#cluster-dag)), a group spreading over
  several, so the `stream` and `streamOffset` columns and the dependency lists differ from a 14
  cook's. 14 keeps every column: a pinned
  bundle holds the DAG's whole root page — its roots, then whole groups, coarsest first, up to
  32 KiB and 64 clusters ([Cluster DAG](#cluster-dag)) —, not its roots alone. 13 lays every geometry page in a
  streaming bundle of the compile's geometry containers: a bundle names its file by rank in the
  manifest's `geometryFiles`, its offset and its digest, a page its bundle and its place there; the
  `pageSha` and `geometrySha` columns are gone; it also rounded the clusters cut free (each pair
  re-cut where their smallest balls were narrowest, since replaced by the parts of the triangles'
  graph, `codec/partition.rs`), so the level-0 clusters and every page differ from a 12 cook's. 12 cut the clusters by the one clusterer
  (`codec/clusters.rs`, the spatial rule) and built the culling tree, which the page order follows,
  by the one builder (`codec/culling.rs`, each split on the axis of least cost).
- Writes `rust/manifest_binary.rs:Encoded` (each column encoded once, a page cut from them); reads `core/manifest/binaryRead.ts:readManifestColumns`,
  `core/manifest/binaryDecode.ts:decodeManifestBinary`.

## Cluster DAG

Per primitive: clusters, the groups replacing them level by level, a culling tree and STREAMING
PAGES — the bundles of `streams.pages`, the unit the runtime reads, installs, keeps and drops,
one geometry pool slot each — whose dependencies close up to the root pages. The page assignment
(`rust/compiler/pages/bundles.rs:assign_pages`) walks the groups from the coarsest level to the
finest — the roots first, as one group —, within a level by the Morton code of their LOD balls'
centres on a 1024-cell grid along the longest side of the box of every centre, the code's bits
flipped on an odd level so the end of one level lies near the start of the next
(`bundles/order.rs`); each group's clusters along the diagonal of their own balls. Each cluster
fills the current page while it holds its resident bytes ([Pages](pages.md#pages)) and one more cluster, else a new page: a group
spreads over several pages. The first pages are the ROOT PAGES — `streams.pinned` counts them —,
32 KiB and 64 clusters at most (`ROOT_PAGE_BYTES`, `ROOT_PAGE_CLUSTERS`), as many as the mesh's
`alwaysResidentKib` fills, one at least ([COMPILER.md](../compiler/how-a-mesh-coarsens.md#mesh-build-settings)), and every
page up to the last holding a root; the others 128 KiB and 256 clusters at most
(`STREAM_BUNDLE_BYTES`, `STREAM_PAGE_CLUSTERS`). A cluster page past a streaming page's bytes is
refused (`CLUSTER_PAGE_TOO_LARGE`). Every page holding a cluster of a group lists every page of
each group holding one of its outputs, the root pages of the roots for one nothing replaces
(`rust/compiler/pages/dependencies.rs`), closed transitively; a root page lists root pages only.
A session keeps every cluster of a root page and of a page holding a root, whatever the view
(`browser/frame/prepare/rootCover.ts`, `PageRec.pinned`).

The clusters' RANKS — what `pages`, `structure` and the culling tree name them by — are the order
the pages are filled in, page after page. The CULLING TREE (`primitives[].culling`, `CULLING_STRIDE`
16 numbers a node: box min and max, LOD ball, replacement error ceiling — -1 over a subtree holding
a root —, least own error, first child, child count, first page, page count) has one leaf per GROUP
PART, the run of ranks of one group one page holds (a root a part of its own): its box the box of
its clusters', its group's LOD ball and replacement error, the least of its clusters' own errors.
Each level's parts get a tree of their own, complete with four children a node (`CULLING_FANOUT`),
its parts sorted at each binary split along the axis whose two sides' boxes have the least summed
surface; the three coarsest levels' roots and a tree of the others hang under the root. An inner
node holds its children's box, the ball of their balls, the least own error and the largest ceiling
below it; its children lie side by side after it (`rust/compiler/hierarchy.rs`,
`codec/culling/tree.rs`).

A position a simplification leaves on a source vertex's comes back from the build's frame bit for
bit (`rust/simplify/region.rs`): the coarse pages of a simplified cook, in the content-addressed
`objects/*.bin` (any version change allows them) and in `world-roots.dag` (`WORLD_ROOTS_VERSION`),
differ from an earlier cook's for the same source.

- Types: `core/contracts/geometry.ts` (`Page`, `ClusterStructure`, `StreamCatalogue`); the cut,
  `browser/geometry/cut/rule.ts:drawsCluster`.
- Writes `rust/dag.rs`, `rust/compiler/pages/bundles.rs:assign_pages`,
  `rust/compiler/pages/dependencies.rs`; the culling tree
  `codec/culling.rs:build_culling_bvh`, the one builder of a primitive's, the world's
  (`world-roots.dag`) and a run-time cut's hierarchy.
