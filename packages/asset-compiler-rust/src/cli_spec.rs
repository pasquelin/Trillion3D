//! Reading a batch file: what each job asks for, and what the batch budget allows
//! to admit in parallel. Split from its execution to keep the repository line limit.
use super::Cancellation;
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use trillion3d_compiler::{
    compiler_budget::{batch_share, fit_workers},
    texture_formats, Options, TEXTURE_FORMAT_DEFAULT,
};

fn number(value: Option<&Value>, default: usize) -> Result<usize, String> {
    match value {
        None | Some(Value::Null) => Ok(default),
        Some(v) => v
            .as_u64()
            .filter(|n| *n > 0)
            .map(|n| n as usize)
            .ok_or_else(|| format!("{v} is not a positive integer")),
    }
}
fn text<'a>(value: Option<&'a Value>, default: &'a str) -> &'a str {
    value.and_then(Value::as_str).unwrap_or(default)
}
/// Identity of a destination, whether it already exists or not. `canonicalize`
/// alone fails on a missing folder and then returns the raw text: `x` and `p/../x`
/// used to pass as two caches. Resolution is therefore two-step. First the path
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
/// Batch file: `{"workers":2,"ramBudgetMb":16384,"threads":4,"jobs":[{"id":..,"source":..,"cache":..,"scope":..,"triangles":..,"resourceBaseUrl":..,"simplification":..,"threads":..,"ramBudgetMb":..}]}`.
/// Per-job RAM defaults to the batch budget divided by the admitted concurrency, which is itself
/// lowered until the jobs running at the same time fit in that budget.
pub(super) fn parse_batch(
    spec: &Value,
    cancellation: &Cancellation,
) -> Result<(usize, Vec<(String, Options)>), String> {
    let workers = number(spec.get("workers"), 1)?.min(64);
    let ram_total = number(spec.get("ramBudgetMb"), 256 * workers)?;
    let default_threads = number(spec.get("threads"), 2)?;
    // Announced concurrency is admitted only if the total can carry it: a share
    // never goes below a job's floor, so it is the worker count that yields.
    let (workers, default_ram) = batch_share(workers, ram_total)?;
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
        let id = text(job.get("id"), "").to_string();
        let id = if id.is_empty() {
            format!("job-{i}")
        } else {
            id
        };
        if !seen.insert(id.clone()) {
            return Err(format!("duplicate job id {id}"));
        }
        let source = text(job.get("source"), "");
        let cache = text(job.get("cache"), "");
        let resource_base = text(job.get("resourceBaseUrl"), "");
        if source.is_empty() || cache.is_empty() || resource_base.is_empty() {
            return Err(format!(
                "job {id}: source, cache and resourceBaseUrl are required"
            ));
        }
        // One cache holds one pointer per scope and prunes itself after each job: two jobs writing
        // it, under whatever spelling, would destroy each other's output.
        if let Some(other) = caches.insert(cache_identity(Path::new(cache)), (id.clone(), cache)) {
            return Err(format!(
                "job {id}: cache {cache} is the directory that job {} already writes as {}",
                other.0, other.1
            ));
        }
        let field = |name: &str, default: usize| {
            number(job.get(name), default).map_err(|e| format!("job {id}: {name} {e}"))
        };
        let options = Options {
            source: PathBuf::from(source),
            cache: PathBuf::from(cache),
            resource_base: resource_base.to_string(),
            scope: text(job.get("scope"), "full").to_string(),
            triangle_budget: field("triangles", 150000)?,
            threads: field("threads", default_threads)?,
            ram_budget_mb: field("ramBudgetMb", default_ram)?,
            simplification: text(job.get("simplification"), "none").to_string(),
            texture_formats: texture_formats(text(
                job.get("texturesFormat"),
                TEXTURE_FORMAT_DEFAULT,
            ))
            .map_err(|e| format!("job {id}: {e}"))?,
            cancelled: cancellation.flag(&id),
        };
        parsed.push((id, options));
    }
    // Shares that jobs themselves request enter the same total: the greediest
    // that would run in parallel must fit there together.
    Ok((fit_workers(workers, ram_total, &parsed)?, parsed))
}
