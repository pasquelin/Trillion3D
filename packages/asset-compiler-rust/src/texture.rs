//! Mip chain of each atlas texture, baked once for all.
//!
//! Engine wrote tail of chain — from level with no side exceeding `PREVIEW_BASE`
//! to 1x1 — from sidecar, then waited for full resolution and regenerated ALL
//! rest on GPU. Between 64 px and source no level existed: texture
//! needing 256 px had to load and decode 2048², residence could
//! not keep up with screen. Here, every level exists: tail in sidecar,
//! RGBA8 and in each kept family's blocks; levels above are GPU block files in
//! cache, one file per level, addressed by source byte hash and chain
//! (`textures/<sha>/<srgb|linear>-<k>.<format>`), shared
//! across scenes sharing image, never rewritten if present. Every chain the
//! quality gate lets is stored in BC (`blocks.rs`: BC7, BC5 for a normal map) —
//! one byte per texel in the pool instead of four, each tile record deflated on
//! disk —, which a device without BC decodes to RGBA8; a chain under the bar
//! keeps no level file, the engine loads its source image, lossless. Beside it,
//! when the gate lets them, the families the cook asked for — every one by
//! default: ASTC and ETC2 for mobile cards —, and the tail carried in those
//! blocks too.
//!
//! Reduction (`reduce.rs`): the mean of the four texels of every channel, each atlas by its own
//! curve — base color and emissive in one, metallic-roughness, normal, occlusion in other —;
//! the levels a file stores (a DDS's) are kept, the rest reduced from the last. A texture a file
//! stores in floating point (OpenEXR, Radiance HDR) read as a base color or an emissive map is
//! chained in floating point (`hdr.rs`) and held in half-float RGBA — its own atlas, `hdr`, no
//! block family —, its levels above the tail written as files of its own (`bake/half.rs`).
//!
//! Failed decode — format outside image driver registry, corrupt PNG, missing
//! image — is named report entry and zero levels: compilation never fails
//! for an unreadable texture, engine falls back to default white. Insufficient
//! baking memory instead refuses the job before decoding; it never drops an image.
use super::*;

pub(crate) mod admission;
pub(crate) mod bake;
pub(crate) mod binding;
pub(crate) mod blocks;
pub(crate) mod collect;
mod curves;
pub(crate) mod cut;
mod entry;
mod gate;
pub(crate) mod hdr;
mod levels;
pub(crate) mod reduce;
mod report;
pub(crate) mod setting;
pub(crate) mod source;
#[cfg(test)]
pub(crate) mod tests;
mod verdict;
pub use entry::{PreviewSource, TexturePreview};
pub use levels::*;

/// Section contract: moving level scale, order, reduction rule, color space,
/// a block codec or the gate's bar requires incrementing this version and
/// binary sidecar version carrying it. Version 3 is GPU rule and full chain,
/// both atlases included; version 4 adds the gated block-compressed levels and
/// tails. A new chain under a name of its own moves no existing file and needs
/// no increment. Version 5 counted a coverage chain's coverage on the filtered cut (#43), a chain
/// version 11 removes. Version 6 lays a block
/// level file out in tile records, one HTTP Range each (#962, `tile_records`);
/// the manifest's `textures.version` names it for the engine. Version 7 adds
/// the ETC2 family (ETC2 RGBA8, EAC RG11): a third block column and layout
/// word, and every family cooked by default. Version 8 stores every level in BC, no PNG: BC7
/// searched in every mode, a chain under the bar left to its source image, each tile record of a
/// block level file deflated behind a head of record ends (`tile_records`). Version 9 encodes each
/// BC7 block whose fast read-back misses the gate's bars again with the slow search, and
/// keys a chain's folder by its source and the sheet that decides its bytes (`GateSheet::key`):
/// two readings of one image under other channels or cuts never share a file. Version 10 moves
/// the BC7 bytes of most blocks: the vendored encoder's axis search starts from the covariance's
/// widest row instead of grey (`block_compression`, `compute_axis`), which every block's search
/// goes through — the ones varying orthogonally to grey, flat before, gain the most. Version 11
/// moves the levels of every chain with an alpha that varies and of every DDS that stores its
/// levels: alpha is the mean of four texels, no coverage chain weighs colours by it or scales it,
/// and the stored levels are kept, not reduced again. Version 12 adds the half-float atlas: an
/// entry of atlas word 2 whose pixel column holds half-float texels and whose level files are
/// `rgba16f` tile records of texels. The texture's compression setting (`setting.rs`) adds the
/// layout words 3 and 4 — BC6H blocks of a half-float chain (an `hdr` entry then names a block
/// layout and carries its tail in the stored family's column) and BC4 blocks of eight bytes — as
/// new chains under names of their own: no existing byte moves, no increment. BC7 encoded once with
/// the basic search, in place of the fast one and the slow one after it, moves the BC7 bytes under
/// chain keys of their own, the encoder's settings in them (`blocks::encoding`): no file another
/// encoding wrote is read, no increment.
pub const TEXTURE_PREVIEW_VERSION: u32 = 12;
pub use bake::write::{level_path, texture_version_dir, LEVEL_WRITE_FAILED, TEXTURE_DIR};
pub use blocks::{BlockFormat, Layout, FAMILIES};
pub(crate) use curves::{linear_table, linear_to_srgb, srgb_table};
pub use reduce::AtlasKind;
/// Baked level template path, relative to `native/`; `bake::write::level_path`
/// populates. `{format}` is a block format's file name (`BlockFormat::file_name`).
pub fn level_template() -> String {
    format!(
        "{}/{{kind}}-{{level}}.{{format}}",
        bake::write::image_dir("{sha}")
    )
}
/// Largest side sidecar level can have. Choice bounds section: at most
/// 21,844 bytes per texture vs megabytes a 256/512 level would add.
pub const PREVIEW_BASE: u32 = 64;
/// Max levels entry carries: 64, 32, 16, 8, 4, 2, 1.
pub const PREVIEW_MAX_LEVELS: u32 = 7;
/// Decode memory allocation ceiling. Larger image is report entry, not failure.
pub(crate) const PREVIEW_MAX_ALLOC: u64 = 512 * 1024 * 1024;

/// Everything step reads. `view_map` translates input glTF views to those written in
/// `source.gltf`, so origin names index engine sees.
pub(super) struct PreviewInputs<'a> {
    pub o: &'a Options,
    /// Source and geometry reservation already admitted by the compiler plan.
    pub reserved_bytes: usize,
    pub g: &'a Value,
    pub bin: &'a [u8],
    /// Resolution root of intermediate scene images, named by `plugins::scene`:
    /// source folder, or extracted folder of container — never cache folder.
    pub image_root: &'a Path,
    /// Materials of the compiled meshes (`collect::used_materials`), read once per compilation.
    pub used_materials: &'a BTreeSet<usize>,
    pub view_map: &'a BTreeMap<usize, usize>,
    /// The fingerprint of every image the step reads, taken once before the bake
    /// (`source::ImageShas`): the bake addresses its files by it, never hashes again.
    pub image_shas: &'a source::ImageShas,
}

/// Calculates chain for each atlas texture of retained meshes, single image decode
/// once regardless of citing textures. Returns entries sorted by texture then
/// atlas, and step report. Images processed in parallel on
/// caller pool, as many at once as their working sets and retained tails admit.
pub(super) fn stage_texture_previews(
    inputs: &PreviewInputs<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Vec<TexturePreview>, Value)> {
    let wanted = collect::atlas_textures(inputs.g, inputs.used_materials);
    let (Some(textures), Some(images)) = (
        inputs.g.get("textures").and_then(Value::as_array),
        inputs.g.get("images").and_then(Value::as_array),
    ) else {
        let report = report::report(
            inputs.o,
            &wanted,
            &[],
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
        );
        return Ok((Vec::new(), report));
    };
    // Per image: (texture, atlas) reading it. Texture without image is report
    // entry, not image to decode.
    let mut by_image: BTreeMap<usize, Vec<collect::AtlasTexture>> = BTreeMap::new();
    let mut skipped: BTreeMap<&'static str, usize> = BTreeMap::new();
    for entry in &wanted {
        match textures
            .get(entry.texture)
            .ok_or("texture-out-of-bounds")
            .and_then(|t| binding::texture_image(t).ok_or("texture-without-image"))
        {
            Ok(image) => by_image
                .entry(image as usize)
                .or_default()
                .push(entry.clone()),
            Err(reason) => *skipped.entry(reason).or_default() += 1,
        }
    }
    let results = admission::bake(inputs, images, &by_image, progress)?;
    let mut previews = Vec::new();
    let mut gates = Vec::new();
    let mut notes: BTreeMap<&'static str, usize> = BTreeMap::new();
    for outcome in results {
        match outcome {
            Ok(baked) => {
                for note in baked.notes {
                    *notes.entry(note).or_default() += 1;
                }
                previews.extend(baked.previews);
                gates.extend(baked.gates);
            }
            Err((reason, count)) => *skipped.entry(reason).or_default() += count,
        }
    }
    previews.sort_by_key(|p| (p.texture, p.kind));
    gates.sort_by(|a, b| {
        (&a.sha256, a.kind, a.format.name()).cmp(&(&b.sha256, b.kind, b.format.name()))
    });
    let report = report::report(inputs.o, &wanted, &previews, &gates, &skipped, &notes);
    Ok((previews, report))
}
