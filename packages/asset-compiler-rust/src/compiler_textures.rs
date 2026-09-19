//! Texture stage: the baked mip chain of each atlas texture, then the cutout
//! sheet that its decoding measures.
//!
//! The two belong together because they share a decode: measuring a texture's
//! alpha needs the same full-resolution image as its preview pyramid, and
//! decoding it twice would cost a large scene's seconds a second time.
use super::*;
use crate::texture_preview::TexturePreview;

/// Everything the stage reads. `primitives` serves only the sheet ranking: a
/// texture that still holds blend primitives is the one there is most to gain by
/// deciding.
pub(super) struct TextureStage<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub image_root: &'a Path,
    pub meshes: &'a BTreeSet<usize>,
    pub view_map: &'a BTreeMap<usize, usize>,
    pub decisions: &'a cutout::Decisions,
    pub applied: &'a cutout::CutoutApplied,
    pub primitives: &'a [Value],
}

/// Returns the previews, the preview report and the cutout report. The answer
/// sheet and its page are written on EVERY compilation, whether there is something
/// to decide or not: it is the sheet that says whether a re-read is due.
pub(super) fn stage_textures(
    pool: &rayon::ThreadPool,
    stage: &TextureStage<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Vec<TexturePreview>, Value, Value)> {
    // Images decode on the job pool, one per worker, each under a decode's
    // allocation ceiling; the sheet is written once they are all done.
    let (previews, shapes, preview_report) = pool.install(|| {
        texture_preview::stage_texture_previews(
            &texture_preview::PreviewInputs {
                o: stage.o,
                g: stage.g,
                bin: stage.bin,
                image_root: stage.image_root,
                meshes: stage.meshes,
                view_map: stage.view_map,
                to_measure: &stage.applied.to_measure(),
            },
            progress,
        )
    })?;
    let weights = cutout::draw_weights(stage.primitives, &stage.applied.materials_by_texture);
    let entries = cutout::entries(stage.g, &previews, &shapes, stage.decisions, &weights);
    let sheet = stage.o.cache.join(cutout::DECISIONS_FILE);
    cutout::write_sheet(&sheet, &cutout::build_sheet(&entries, stage.decisions))?;
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
