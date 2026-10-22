//! The bounds and choices a job's options must respect, checked once whatever form named them.
use super::*;

/// The one check of a job's values, whichever form named them (`compiler/args.rs`): the bounds
/// and the choices `compilerAbi.ts` declares, printed into `shared_math/abi.rs`.
pub(crate) fn validate_compile_options(o: &Options) -> Result<()> {
    let refusal = if !SCOPES.contains(&o.scope.as_str()) {
        Some(format!(
            "{} must be {}",
            job_field::SCOPE,
            SCOPES.join(" or ")
        ))
    } else if o.triangle_budget == 0 {
        Some(format!("{} must be positive", job_field::TRIANGLE_BUDGET))
    } else if o.threads == 0 || o.threads > MAX_THREADS {
        Some(format!("{} must be 1 to {MAX_THREADS}", job_field::THREADS))
    } else if o.ram_budget_mb < MIN_RAM_BUDGET_MB {
        Some(format!(
            "{} must be at least {MIN_RAM_BUDGET_MB}",
            job_field::RAM_BUDGET_MB
        ))
    } else if o.resource_base.is_empty() {
        Some(format!("{} is required", job_field::RESOURCE_BASE_URL))
    } else if !SIMPLIFICATIONS.contains(&o.simplification.as_str()) {
        Some(format!(
            "{} must be {}",
            job_field::SIMPLIFICATION,
            SIMPLIFICATIONS.join(" or ")
        ))
    } else {
        (o.hlod.as_ref().err().cloned())
            .or_else(|| o.materials.as_ref().err().cloned())
            .or_else(|| o.voxelize.as_ref().err().cloned())
            .or_else(|| o.partition_grid.as_ref().err().cloned())
            .or_else(|| o.mesh_build.as_ref().err().cloned())
            .or_else(|| o.object_settings.as_ref().err().cloned())
            .or_else(|| o.lightmap_bake.as_ref().err().cloned())
    };
    match refusal {
        Some(message) => Err(CompilerError::new("INVALID_OPTIONS", message)),
        None => Ok(()),
    }
}
