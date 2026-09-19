//! Mip chain of each atlas texture, baked once for all.
//!
//! Engine wrote tail of chain — from level with no side exceeding `PREVIEW_BASE`
//! to 1x1 — from sidecar, then waited for full resolution and regenerated ALL
//! rest on GPU. Between 64 px and source no level existed: texture
//! needing 256 px had to load and decode 2048², residence could
//! not keep up with screen. Here, every level exists: tail in sidecar,
//! RGBA8; levels above are lossless PNGs in cache, one file per level,
//! addressed by source byte hash and atlas (`textures/<sha>/<srgb|linear>-<k>.png`),
//! shared across scenes sharing image, never rewritten if present.
//!
//! Reduction rule matches GPU (`reduce.rs`): baking instead of
//! regenerating does not change image. Covers both engine atlases — base color
//! and emissive in one, metallic-roughness, normal, occlusion in other —, each by own curve.
//!
//! Failed decode — format outside image driver registry, corrupt PNG, missing
//! image — is named report entry and zero levels: compilation never fails
//! for texture, engine falls back to default white.
use super::*;
use std::sync::atomic::AtomicUsize;

pub(crate) mod bake;
pub(crate) mod collect;
mod curves;
mod levels;
mod reduce;
pub(crate) mod source;
#[cfg(test)]
mod tests;
pub use levels::*;

/// Section contract: moving level scale, order, reduction rule, or
/// color space requires incrementing this version and binary sidecar version
/// carrying it. Version 3 is GPU rule and full chain, both atlases included.
pub const TEXTURE_PREVIEW_VERSION: u32 = 3;
pub use bake::{texture_version_dir, TEXTURE_DIR};
pub use reduce::AtlasKind;
/// Baked level template path, relative to `native/`; `bake::level_path` populates.
pub fn level_template() -> String {
    format!(
        "{}/{{sha}}/{{kind}}-{{level}}.png",
        bake::texture_version_dir()
    )
}
/// Largest side sidecar level can have. Choice bounds section: at most
/// 21,844 bytes per texture vs megabytes a 256/512 level would add.
pub const PREVIEW_BASE: u32 = 64;
/// Max levels entry carries: 64, 32, 16, 8, 4, 2, 1.
pub const PREVIEW_MAX_LEVELS: u32 = 7;
/// Decode memory allocation ceiling. Larger image is report entry, not failure.
const PREVIEW_MAX_ALLOC: u64 = 512 * 1024 * 1024;

/// Origin of preview source bytes. `uri` itself not copied: read
/// in `source.gltf` at `images[image]`, which entry names.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PreviewSource {
    Uri,
    BufferView(u32),
}
impl PreviewSource {
    pub fn kind(self) -> u32 {
        match self {
            Self::Uri => 0,
            Self::BufferView(_) => 1,
        }
    }
    pub fn buffer_view(self) -> u32 {
        match self {
            Self::Uri => u32::MAX,
            Self::BufferView(view) => view,
        }
    }
}

/// Section entry: texture covered, origin, level bytes.
/// `first_level` and level count re-deduced from `width` and `height`; carrying in
/// entry lets reader refuse entry contradicting own dimensions.
pub struct TexturePreview {
    pub texture: u32,
    pub image: u32,
    pub width: u32,
    pub height: u32,
    pub source: PreviewSource,
    pub sha256: String,
    /// Atlas entry serves: same texture can have one per atlas.
    pub kind: AtlasKind,
    pub first_level: u32,
    /// Levels written in cache as PNG files, 0 to `baked_levels - 1`: `first_level`
    /// when chain complete, 0 when nothing could be written.
    pub baked_levels: u32,
    pub pixels: Vec<u8>,
}

/// Everything step reads. `view_map` translates input glTF views to those written in
/// `source.gltf`, so origin names index engine sees.
pub(super) struct PreviewInputs<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    /// Resolution root of intermediate scene images, named by `plugins::scene`:
    /// source folder, or extracted folder of container — never cache folder.
    pub image_root: &'a Path,
    pub meshes: &'a BTreeSet<usize>,
    pub view_map: &'a BTreeMap<usize, usize>,
    /// Textures whose alpha to measure on pass, designated by `cutout`: this step
    /// knows what it decodes, not what cutout is.
    pub to_measure: &'a BTreeSet<usize>,
}

/// Calculates chain for each atlas texture of retained meshes, single image decode
/// once regardless of citing textures. Returns entries sorted by texture then
/// atlas, candidate cutout alpha shape — measured in this decode,
/// never second —, and step report. Images processed in parallel on
/// caller pool, each within decode allocation limit.
pub(super) fn stage_texture_previews(
    inputs: &PreviewInputs<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(
    Vec<TexturePreview>,
    BTreeMap<usize, crate::cutout::AlphaShape>,
    Value,
)> {
    let wanted = collect::atlas_textures(inputs.g, inputs.meshes)?;
    let (Some(textures), Some(images)) = (
        inputs.g.get("textures").and_then(Value::as_array),
        inputs.g.get("images").and_then(Value::as_array),
    ) else {
        let report = bake::report(&wanted, &[], &BTreeMap::new(), &BTreeMap::new());
        return Ok((Vec::new(), BTreeMap::new(), report));
    };
    // Per image: (texture, atlas) reading it. Texture without image is report
    // entry, not image to decode.
    let mut by_image: BTreeMap<usize, Vec<collect::AtlasTexture>> = BTreeMap::new();
    let mut skipped: BTreeMap<&'static str, usize> = BTreeMap::new();
    for entry in &wanted {
        match textures
            .get(entry.texture)
            .ok_or("texture-out-of-bounds")
            .and_then(|t| {
                t.get("source")
                    .and_then(Value::as_u64)
                    .ok_or("texture-without-image")
            }) {
            Ok(image) => by_image.entry(image as usize).or_default().push(*entry),
            Err(reason) => *skipped.entry(reason).or_default() += 1,
        }
    }
    let done = AtomicUsize::new(0);
    let total = by_image.len();
    let results: Vec<_> = by_image
        .par_iter()
        .map(|(&image_index, readers)| {
            check(inputs.o)?;
            let outcome = bake::one_image(inputs, images, image_index, readers);
            let completed = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress(json!({"phase":"textures","completed":completed,"total":total}));
            Ok(outcome)
        })
        .collect::<Result<Vec<_>>>()?;
    let mut previews = Vec::new();
    let mut shapes = BTreeMap::new();
    let mut notes: BTreeMap<&'static str, usize> = BTreeMap::new();
    for outcome in results {
        match outcome {
            Ok(baked) => {
                shapes.extend(baked.shapes);
                for note in baked.notes {
                    *notes.entry(note).or_default() += 1;
                }
                previews.extend(baked.previews);
            }
            Err((reason, count)) => *skipped.entry(reason).or_default() += count,
        }
    }
    previews.sort_by_key(|p| (p.texture, p.kind));
    let report = bake::report(&wanted, &previews, &skipped, &notes);
    Ok((previews, shapes, report))
}
