//! Texture stage: the baked mip chain of each atlas texture.
use crate::texture::TexturePreview;
use crate::*;

/// Everything the stage reads.
pub(crate) struct TextureStage<'a> {
    pub o: &'a Options,
    pub reserved_bytes: usize,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub image_root: &'a Path,
    pub used_materials: &'a BTreeSet<usize>,
    pub image_shas: &'a crate::texture::source::ImageShas,
    pub view_map: &'a BTreeMap<usize, usize>,
}

/// Returns the previews and the preview report. Images decode on the job pool, one per worker,
/// each under a decode's allocation ceiling.
pub(crate) fn stage_textures(
    pool: &rayon::ThreadPool,
    stage: &TextureStage<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Vec<TexturePreview>, Value)> {
    pool.install(|| {
        crate::texture::stage_texture_previews(
            &crate::texture::PreviewInputs {
                o: stage.o,
                reserved_bytes: stage.reserved_bytes,
                g: stage.g,
                bin: stage.bin,
                image_root: stage.image_root,
                used_materials: stage.used_materials,
                view_map: stage.view_map,
                image_shas: stage.image_shas,
            },
            progress,
        )
    })
}
