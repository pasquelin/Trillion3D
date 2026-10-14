//! Reading a batch file: what each job asks for, and what the batch budget allows
//! to admit in parallel. Split from its execution to keep the repository line limit.
use super::Cancellation;
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use trillion3d_compiler::{
    compiler_budget::{batch_share, fit_workers},
    job_field, job_options, positive, JobDefaults, Options, DEFAULT_RAM_BUDGET_MB, DEFAULT_THREADS,
};

/// Identity of a destination, whether it already exists or not. `canonicalize`
/// alone fails on a missing folder and then returns the raw text: `x` and `p/../x`
/// would pass as two caches. Resolution is therefore two-step. First the path
/// becomes absolute and its `.` disappear, each `..` walking up from the
/// canonicalised path when it exists — a `..` behind a symlink does not walk up
/// where the text says. Then the longest existing prefix is canonicalised and the
/// missing suffix is reapplied. Doubled separators do not survive the walk.
fn cache_identity(path: &Path) -> PathBuf {
    let mut walked = if path.is_absolute() {
        PathBuf::new()
    } else {
        std::env::current_dir().unwrap_or_default()
    };
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if let Ok(real) = std::fs::canonicalize(&walked) {
                    walked = real;
                }
                walked.pop();
            }
            other => walked.push(other),
        }
    }
    let mut absent = Vec::new();
    let mut existing = walked.clone();
    loop {
        if let Ok(real) = std::fs::canonicalize(&existing) {
            return absent.iter().rev().fold(real, |path, name| path.join(name));
        }
        let Some(name) = existing.file_name().map(std::ffi::OsString::from) else {
            return walked;
        };
        absent.push(name);
        if !existing.pop() {
            return walked;
        }
    }
}
/// Batch file: `{"workers":2,"ramBudgetMb":16384,"threads":4,"jobs":[{"id":..,"source":..,"cache":..,"scope":..,"triangleBudget":..,"resourceBaseUrl":..,"simplification":..,"threads":..,"ramBudgetMb":..,"texturesFormat":..}]}`,
/// each job read by `job_options`, as the command line's one job is; a job's scope defaults to `full`.
/// Per-job RAM defaults to the batch budget divided by the admitted concurrency, which is itself
/// lowered until the jobs running at the same time fit in that budget.
pub(super) fn parse_batch(
    spec: &Value,
    cancellation: &Cancellation,
) -> Result<(usize, Vec<(String, Options)>), String> {
    let workers = positive(spec.get("workers"), 1, "workers")?.min(64);
    let ram_total = positive(
        spec.get(job_field::RAM_BUDGET_MB),
        DEFAULT_RAM_BUDGET_MB * workers,
        job_field::RAM_BUDGET_MB,
    )?;
    let threads = positive(
        spec.get(job_field::THREADS),
        DEFAULT_THREADS,
        job_field::THREADS,
    )?;
    // Announced concurrency is admitted only if the total can carry it: a share
    // never goes below a job's floor, so it is the worker count that yields.
    let (workers, ram_budget_mb) = batch_share(workers, ram_total)?;
    let defaults = JobDefaults {
        scope: "full",
        threads,
        ram_budget_mb,
    };
    let jobs = spec
        .get("jobs")
        .and_then(Value::as_array)
        .ok_or("jobs must be an array")?;
    if jobs.is_empty() {
        return Err("jobs must not be empty".into());
    }
    let mut parsed = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut caches = std::collections::HashMap::new();
    for (i, job) in jobs.iter().enumerate() {
        let id = job.get("id").and_then(Value::as_str).unwrap_or("");
        let id = if id.is_empty() {
            format!("job-{i}")
        } else {
            id.to_string()
        };
        if !seen.insert(id.clone()) {
            return Err(format!("duplicate job id {id}"));
        }
        let options = job
            .as_object()
            .ok_or_else(|| "a job must be an object".to_string())
            .and_then(|job| job_options(job, &defaults, cancellation.flag(&id)))
            .map_err(|e| format!("job {id}: {e}"))?;
        // One cache holds one pointer per scope and prunes itself after each job: two jobs writing
        // it, under whatever spelling, would destroy each other's output.
        let cache = options.cache.to_string_lossy().into_owned();
        if let Some(other) =
            caches.insert(cache_identity(&options.cache), (id.clone(), cache.clone()))
        {
            return Err(format!(
                "job {id}: cache {cache} is the directory that job {} already writes as {}",
                other.0, other.1
            ));
        }
        parsed.push((id, options));
    }
    // Shares that jobs themselves request enter the same total: the greediest
    // that would run in parallel must fit there together.
    Ok((fit_workers(workers, ram_total, &parsed)?, parsed))
}
