//! The version, the magic and the header of the manifest's binary: the numbers the readers print
//! from here (`scripts/build/shared-rules/formats.ts`).

/// Version 4 turns the fixed 16×16 preview entries into the variable progressive levels: the pixel
/// column has no stride any more, each entry naming its own byte range. A file of another version is
/// refused whole: a reader that sliced the wrong range would show one texture's levels on another.
/// Version 5 widens a preview entry from ten to twelve words — the atlas it serves and how many
/// levels are baked as files under `textures/` — and its pixels follow the graphics card's mip rule;
/// a version-4 reader would stride through the entries wrongly, so it refuses this file.
/// Version 6 keeps every column and names another geometry page in the geometry descriptor: the
/// quantized `WGP3` page (`geometryPage.ts`) in place of the float `WGP2` page, whose bytes a
/// version-6 reader would refuse one by one at decode; refusing the file says it once.
/// Version 7 widens a preview entry to fourteen words — the layout each block family holds the
/// chain in, or none — and adds two columns: the tails block-compressed, BC family then ASTC,
/// each kept entry's range following from its dimensions; a version-6 reader would not know
/// them, so it refuses.
/// Version 8 adds the page dependencies of the streaming bundles: a count per bundle, then the
/// flat lists, closed up to the root cover (`docs/FORMAT.md` §Cluster DAG), that WebGPU requests
/// and retains with a bundle. A version-7 reader cannot read the lists, so it refuses.
/// Version 9 adds each page's normal cone, in a column a version-8 reader lacks; version 18 drops
/// it again.
/// Version 10 cuts the manifest into pages (`paged.ts`): a sidecar holds the columns of one page,
/// the head's the texture previews alone.
/// Version 11 widens a preview entry to fifteen words and adds a block column after ASTC's: the
/// ETC2 family, the third a device may sample; a version-10 reader would stride wrongly.
/// Version 12 keeps every column; the clusters are cut by the one clusterer of
/// `page-codec-wasm/src/clusters.rs` (the spatial rule) and the culling tree a page order follows
/// is built by the one builder of `page-codec-wasm/src/culling.rs`, each split on the axis of least
/// cost: the DAG, its nodes and its pages differ from a version-11 cook's for the same source.
/// Version 13 lays every geometry page in a streaming bundle of the compile's geometry containers:
/// a bundle names its file, by rank in the manifest's `geometryFiles`, its offset and its digest,
/// a page its bundle and its place there, and the index objects and the per-page digests are gone;
/// a version-12 reader would look for objects that no longer exist, so it refuses. 13 also rounded
/// the clusters the one clusterer cut free, its upper cuts across the longest side (both since
/// replaced by the parts of the triangles' graph, `page-codec-wasm/src/partition.rs`): the
/// level-0 clusters, hence every page, differ from a version-12 cook's for the same source.
/// Version 14 keeps every column; a pinned bundle holds the DAG's whole root page — its roots, then
/// whole groups, coarsest first, up to `ROOT_PAGE_BYTES` and `ROOT_PAGE_CLUSTERS`
/// (`compiler/pages/bundles.rs`) —, not its roots alone: the bundles and their dependency lists
/// differ from a version-13 cook's for the same source.
/// Version 15 keeps every column; the clusters are assigned to streaming pages as the runtime's
/// unit: the groups from the coarsest along a Morton curve, a group spreading over several pages,
/// root pages of 32 KiB and 64 clusters — as many as `meshBuild.alwaysResidentKib` asks, one at
/// least —, others of 128 KiB and 256 (`compiler/pages/bundles.rs`), and a page lists every page of
/// the groups holding its groups' outputs: the pages, the `stream` and `streamOffset` columns and
/// the dependency lists differ from a version-14 cook's for the same source.
/// Version 16 lays the clusters in the order their streaming pages are filled in, and the culling
/// column holds sixteen numbers a node — the least own error beside the ceiling —, one tree per
/// level of four children a node over the group parts, the clusters of one group a page holds
/// (`page-codec-wasm/src/culling.rs`): a version-15 reader would read a node off its stride.
/// Version 17 keeps every column; the pages are the `WGP3` format 9 — positions in centimetres on
/// the cells of one precision a primitive, normals and tangents at their own precisions, colour
/// bytes, up to four texture sets — and the boxes of the culling columns bound the positions the
/// pages decode to: the pages, the box columns and the page sizes differ from a
/// version-16 cook's for the same source, and no record carries a quantization error any more.
/// Version 18 drops the page normal-cone column, the last, which the runtime read none of: a
/// sidecar holds 27 columns, and a version-17 reader would expect 28, so it refuses.
/// Version 19 widens a geometry page's record from five words to seven — the bytes it takes in the
/// pool once installed and where it lies in its streaming page's place there — and its pages are
/// the `WGP3` format 11, written on disk as strips and zig-zag delta streams, naming the vertices
/// they share with other clusters, which the install passes transcode
/// (`page-codec-wasm/src/disk.rs`): a version-18 reader would stride through the records wrongly,
/// so it refuses.
/// Version 20 keeps every column; the pages are the `WGP3` format 12, which carries up to eight
/// texture sets — the ranges of those past the fourth after the header's morph records, only on a
/// page that stores one —, so a version-19 reader would refuse its pages' flags or read their
/// streams off their places.
/// Version 21 keeps every column; a geometry page's `residentBytes` holds the table of the
/// resident page's stream offsets (`RESIDENT_TABLE_WORDS`, 15 words) the shaders read the streams
/// by: a version-20 cache names a size too small by it, which the install pass would refuse page by
/// page, so a reader refuses the file whole and the compiler cooks it again.
/// Version 22 keeps every column; the head's pixel column is empty: the previews' RGBA8 tails are
/// their own file (`preview-pixels-<sha>.bin`, the head's `binary.texturePreviewPixels`), which a
/// session reads only when a lane pins them. The runtime still reads 21, whose column holds them.
pub const MANIFEST_BINARY_VERSION: u32 = 22;
/// 'W','G','M','B' read as a little-endian u32.
pub const MANIFEST_BINARY_MAGIC: u32 = 0x424d_4757;
pub const MANIFEST_BINARY_HEADER_WORDS: usize = 4;
