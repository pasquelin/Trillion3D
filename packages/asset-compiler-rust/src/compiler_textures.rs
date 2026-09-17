//! L'étape des textures : les aperçus progressifs, puis la feuille des découpes qu'ils mesurent.
//!
//! Les deux tiennent ensemble parce qu'elles partagent un décodage : mesurer l'alpha d'une texture
//! demande la même image pleine résolution que sa pyramide d'aperçu, et la décoder deux fois
//! coûterait une seconde fois les secondes d'une grande scène.
use super::*;
use crate::texture_preview::TexturePreview;

/// Tout ce que l'étape lit. `primitives` sert au seul classement de la feuille : une texture qui
/// tient encore des primitives en mélange est celle qu'il y a le plus à gagner à trancher.
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

/// Rend les aperçus, le rapport des aperçus et celui des découpes. La feuille de réponses et sa
/// page sont écrites à CHAQUE compilation, qu'il y ait ou non quelque chose à trancher : c'est la
/// feuille qui dit si une relecture est due.
pub(super) fn stage_textures(
    stage: &TextureStage<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Vec<TexturePreview>, Value, Value)> {
    let (previews, shapes, preview_report) =
        texture_preview::stage_texture_previews(&texture_preview::PreviewInputs {
            o: stage.o,
            g: stage.g,
            bin: stage.bin,
            image_root: stage.image_root,
            meshes: stage.meshes,
            view_map: stage.view_map,
            to_measure: &stage.applied.to_measure(),
        })?;
    let weights = cutout::draw_weights(stage.primitives, &stage.applied.materials_by_texture);
    let entries = cutout::entries(stage.g, &previews, &shapes, stage.decisions, &weights);
    let sheet = stage.o.cache.join(cutout::DECISIONS_FILE);
    let page = stage.o.cache.join(cutout::PAGE_FILE);
    let written = cutout::build_sheet(&entries, stage.decisions);
    cutout::write_sheet(&sheet, &written)?;
    cutout::write_page(&page, &entries, &written, &sheet)?;
    let pending = entries
        .iter()
        .filter(|entry| entry.answer.is_none())
        .count();
    let report = json!({"version":cutout::SHEET_VERSION,"sheet":sheet.to_string_lossy(),
        "page":page.to_string_lossy(),"textures":entries.len(),"pending":pending,
        "changes":stage.applied.report(stage.decisions)});
    progress(
        json!({"phase":"cutouts","completed":1,"total":1,"pending":pending,
        "page":page.to_string_lossy()}),
    );
    Ok((previews, preview_report, report))
}
