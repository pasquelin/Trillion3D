//! The textures and the meshes' distance fields, built side by side: the fields read no texture
//! (`distance_field::Scene::read`), so the device's batches and the CPU's doubtful voxels fill what
//! the textures leave idle, rather than running after them.
use super::*;
use crate::distance_field::{build_mesh_fields, working_bytes, DistanceFieldInputs, Placed};
use crate::texture::TexturePreview;

/// The job's texture previews with their report, and its meshes' distance fields, the two built at
/// once on the job's pool; the textures admitted beside what the fields hold at most
/// (`distance_field::working_bytes`), or after them, alone, where the budget holds no more.
pub(super) fn textures_and_fields(
    job: &Job<'_>,
    built: &Built,
    progress: &(impl Fn(Value) + Sync),
) -> Result<((Vec<TexturePreview>, Value), Vec<Placed>)> {
    let field_settings: Vec<_> = (job.mesh_builds.iter())
        .map(|build| build.distance_field)
        .collect();
    let fields = DistanceFieldInputs {
        g: &job.loaded.g,
        bin: job.bin,
        mesh_map: &job.picked.mesh_map,
        settings: &field_settings,
        cancelled: &job.o.cancelled,
    };
    let beside = working_bytes(&fields)?;
    let stage = texture_stage(job, built, beside);
    let (textures, distance) = built.pool.install(|| {
        rayon::join(
            || stage_textures(&built.pool, &stage, progress),
            || build_mesh_fields(&fields),
        )
    });
    // A budget that holds the textures alone but not the fields beside them bakes them after the
    // fields, alone, as it always did: the same bytes, refused only where they were refused.
    let textures = match textures {
        Err(refused)
            if beside > 0
                && distance.is_ok()
                && refused.code == "RAM_ADMISSION_BUDGET_EXCEEDED" =>
        {
            stage_textures(&built.pool, &texture_stage(job, built, 0), progress)
        }
        textures => textures,
    };
    Ok((textures?, distance?))
}

/// What the texture previews are staged from, `beside` bytes held by the work that runs with them.
fn texture_stage<'a>(job: &Job<'a>, built: &'a Built, beside: usize) -> TextureStage<'a> {
    TextureStage {
        o: job.o,
        reserved_bytes: built.plan.estimated_working_bytes.saturating_add(beside),
        g: &job.loaded.g,
        bin: job.bin,
        image_root: job.image_root,
        used_materials: &job.images.used_materials,
        image_shas: &job.images.shas,
        view_map: &built.plan.view_map,
    }
}
