//! The version, the magic and the header of the manifest's binary: the numbers the readers print
//! from here (`scripts/shared-rules/formats.ts`).

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
/// Version 9 adds each page's normal cone, cooked by the compiler (`Page.cone`), in a column a
/// version-8 reader lacks.
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
/// level-0 clusters, hence every page, differ from a version-12 cook's for the same source; and it measures each page's cone on the positions the page decodes
/// to (`page-codec-wasm/src/encode.rs:decoded_cone`), not the source's, so the cone column differs.
pub const MANIFEST_BINARY_VERSION: u32 = 13;
/// 'W','G','M','B' read as a little-endian u32.
pub const MANIFEST_BINARY_MAGIC: u32 = 0x424d_4757;
pub const MANIFEST_BINARY_HEADER_WORDS: usize = 4;
