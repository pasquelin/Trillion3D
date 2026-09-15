use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

mod box_reduce;
mod cancellation;
mod collect_textures;
mod decode_failure;
mod image_source;
mod levels;
mod mask_coverage;
mod pyramid_bleed;

/// A fresh directory under the OS temp dir, unique per call so parallel tests never collide.
pub(super) fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wg-texture-preview-{tag}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}
/// Minimal `Options` a stage needs; only `cancelled` and `source` ever matter to these tests.
pub(super) fn options(source: &Path) -> Options {
    Options {
        source: source.to_path_buf(),
        cache: source.join("cache"),
        resource_base: "/assets/".into(),
        scope: "full".into(),
        triangle_budget: 1,
        threads: 1,
        ram_budget_mb: 64,
        simplification: "none".into(),
        cancelled: Arc::new(AtomicBool::new(false)),
    }
}
pub(super) fn rgba_from(
    width: u32,
    height: u32,
    pixel: impl Fn(u32, u32) -> [u8; 4],
) -> image::RgbaImage {
    image::RgbaImage::from_fn(width, height, |x, y| image::Rgba(pixel(x, y)))
}
/// A level's straight-alpha sRGB8 pixel bytes, sliced out of the pyramid's flat 1364 bytes.
pub(super) fn level_bytes(pixels: &[u8], level: usize) -> &[u8] {
    let start = PREVIEW_LEVEL_OFFSETS[level] as usize;
    let side = PREVIEW_LEVEL_SIZES[level] as usize;
    &pixels[start..start + side * side * 4]
}
