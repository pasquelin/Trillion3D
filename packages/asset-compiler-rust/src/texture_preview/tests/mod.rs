use super::*;
use crate::tests::directories::scratch;
use crate::tests::fixtures::options_in as options;

mod admission;
mod atlas_rule;
mod bake_files;
mod box_reduce;
mod cached_shape;
mod cancellation;
mod collect_textures;
mod coverage_alpha;
pub(crate) mod coverage_filtered;
mod decode_failure;
mod gate;
mod gate_verdict;
mod image_source;
mod levels;
mod median_alpha;
mod tile_records;
mod weighted_colour;

/// Minimal `Options` a stage needs, its cache under `source`; only `cancelled`, `source` and
/// `cache` ever matter to these tests.
pub(super) fn rgba_from(
    width: u32,
    height: u32,
    pixel: impl Fn(u32, u32) -> [u8; 4],
) -> image::RgbaImage {
    image::RgbaImage::from_fn(width, height, |x, y| image::Rgba(pixel(x, y)))
}
/// Sidecar tail of a source, as `bake` produces: full chain reduced to
/// its levels starting from first carried.
pub(super) fn tail_of(source: &image::RgbaImage, kind: AtlasKind) -> (u32, Vec<u8>) {
    let first = preview_first_level(source.width(), source.height());
    (first, reduce::tail(&reduce::chain(source, kind), first))
}
/// Dimensions of level at `index` in tail, rank 0 coarsest carried.
pub(super) fn level_size(width: u32, height: u32, index: usize) -> (u32, u32) {
    preview_level_size(
        width,
        height,
        preview_first_level(width, height) + index as u32,
    )
}
/// A level's RGBA8 pixel bytes, sliced out of the tail's variable-length bytes.
pub(super) fn level_bytes(width: u32, height: u32, pixels: &[u8], index: usize) -> &[u8] {
    let mut start = 0usize;
    for step in 0..index {
        let (w, h) = level_size(width, height, step);
        start += (w * h * 4) as usize;
    }
    let (w, h) = level_size(width, height, index);
    &pixels[start..start + (w * h * 4) as usize]
}
/// Progress ignored by these tests.
pub(super) fn silent(_: Value) {}

/// The materials mesh `mesh` of `g` uses: what `atlas_textures` reads.
pub(super) fn used(g: &Value, mesh: usize) -> BTreeSet<usize> {
    collect::used_materials(g, &BTreeSet::from([mesh])).expect("used materials")
}

/// What a compilation reads once before the step, for the scene `g` whose `meshes` are compiled:
/// the materials they use and the fingerprint of every image the step reads.
pub(super) fn read_once(
    g: &Value,
    bin: &[u8],
    image_root: &Path,
    meshes: &BTreeSet<usize>,
) -> (BTreeSet<usize>, crate::texture_preview::source::ImageShas) {
    let used = collect::used_materials(g, meshes).expect("used materials");
    let shas = crate::texture_preview::source::ImageShas::of(g, bin, image_root, &used);
    (used, shas)
}
/// Step run on source folder and scene, mesh 0 retained, nothing to measure,
/// the BC family cooked: shared by end-to-end tests. Returns entries and report.
pub(super) fn stage_scene(dir: &Path, g: &Value) -> (Vec<TexturePreview>, Value) {
    stage_scene_in(dir, g, vec![BlockFormat::Bc7])
}
/// The same, cooking `texture_formats`.
pub(super) fn stage_scene_in(
    dir: &Path,
    g: &Value,
    texture_formats: Vec<BlockFormat>,
) -> (Vec<TexturePreview>, Value) {
    let o = Options {
        texture_formats,
        ..options(dir)
    };
    let view_map = BTreeMap::new();
    let (used, shas) = read_once(g, &[], dir, &BTreeSet::from([0usize]));
    let (previews, _, report) = stage_texture_previews(
        &PreviewInputs {
            o: &o,
            reserved_bytes: 0,
            g,
            bin: &[],
            image_root: dir,
            used_materials: &used,
            view_map: &view_map,
            to_measure: &BTreeSet::new(),
            measurements: crate::cutout::MeasureCache::EMPTY,
            image_shas: &shas,
        },
        &silent,
    )
    .expect("an unreadable texture never fails the compilation");
    (previews, report)
}
