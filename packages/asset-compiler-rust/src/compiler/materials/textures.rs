//! Texture stage: the baked mip chain of each atlas texture, then the cutout
//! sheet that its decoding measures.
//!
//! The two belong together because they share a decode: measuring a texture's
//! alpha needs the same full-resolution image as its preview pyramid, and
//! decoding it twice would cost a large scene's seconds a second time.
use crate::texture::TexturePreview;
use crate::*;

/// Everything the stage reads. `primitives` serves only the sheet ranking: a
/// texture that still holds blend primitives is the one there is most to gain by
/// deciding.
pub(crate) struct TextureStage<'a> {
    pub o: &'a Options,
    pub reserved_bytes: usize,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub image_root: &'a Path,
    pub used_materials: &'a BTreeSet<usize>,
    pub image_shas: &'a crate::texture::source::ImageShas,
    pub view_map: &'a BTreeMap<usize, usize>,
    pub decisions: &'a crate::cutout::Decisions,
    pub applied: &'a crate::cutout::CutoutApplied,
    pub primitives: &'a [Value],
}

/// Returns the previews, the preview report and the cutout report. The answer
/// sheet and its page are written on EVERY compilation, whether there is something
/// to decide or not: it is the sheet that says whether a re-read is due.
pub(crate) fn stage_textures(
    pool: &rayon::ThreadPool,
    stage: &TextureStage<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Vec<TexturePreview>, Value, Value)> {
    // Images decode on the job pool, one per worker, each under a decode's
    // allocation ceiling; the sheet is written once they are all done.
    let (previews, shapes, preview_report) = pool.install(|| {
        crate::texture::stage_texture_previews(
            &crate::texture::PreviewInputs {
                o: stage.o,
                reserved_bytes: stage.reserved_bytes,
                g: stage.g,
                bin: stage.bin,
                image_root: stage.image_root,
                used_materials: stage.used_materials,
                view_map: stage.view_map,
                to_measure: &stage.applied.to_measure(),
                measurements: &stage.decisions.measurements,
                image_shas: stage.image_shas,
            },
            progress,
        )
    })?;
    let weights =
        crate::cutout::draw_weights(stage.primitives, &stage.applied.materials_by_texture);
    let entries = crate::cutout::entries(stage.g, &previews, &shapes, stage.decisions, &weights);
    let sheet = stage.o.cache.join(crate::cutout::DECISIONS_FILE);
    crate::cutout::write_sheet(
        &sheet,
        &crate::cutout::build_sheet(&entries, stage.decisions),
    )?;
    let pending = entries
        .iter()
        .filter(|entry| entry.answer.is_none())
        .count();
    let report = json!({"version":cutout::SHEET_VERSION,"sheet":sheet.to_string_lossy(),
        "textures":entries.len(),"pending":pending,
        "changes":stage.applied.report(stage.decisions)});
    progress(
        json!({"phase":"cutouts","completed":1,"total":1,"pending":pending,
        "sheet":sheet.to_string_lossy()}),
    );
    Ok((previews, preview_report, report))
}
