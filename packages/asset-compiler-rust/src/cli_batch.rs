use super::{emit, error_value, listen_stdin, run_job, Cancellation};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};
use web_geometry_compiler::{shared_math::elapsed_ms, Options};

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
/// Batch file: `{"workers":2,"ramBudgetMb":16384,"threads":4,"jobs":[{"id":..,"source":..,"cache":..,"scope":..,"triangles":..,"resourceBaseUrl":..,"simplification":..,"threads":..,"ramBudgetMb":..}]}`.
/// Per-job RAM defaults to the batch budget divided by the number of workers.
fn parse_batch(
    spec: &Value,
    cancellation: &Cancellation,
) -> Result<(usize, Vec<(String, Options)>), String> {
    let workers = number(spec.get("workers"), 1)?.min(64);
    let ram_total = number(spec.get("ramBudgetMb"), 256 * workers)?;
    let default_threads = number(spec.get("threads"), 2)?;
    let default_ram = (ram_total / workers).max(64);
    let jobs = spec
        .get("jobs")
        .and_then(Value::as_array)
        .ok_or("jobs must be an array")?;
    if jobs.is_empty() {
        return Err("jobs must not be empty".into());
    }
    let mut parsed = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut caches = std::collections::HashSet::new();
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
        // One cache holds one pointer per scope and prunes itself after each job: two concurrent jobs in it would destroy each other's output.
        if !caches.insert(
            std::fs::canonicalize(cache).unwrap_or_else(|_| std::path::PathBuf::from(cache)),
        ) {
            return Err(format!(
                "job {id}: cache {cache} is already used by another job of this batch"
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
            cancelled: cancellation.flag(&id),
        };
        parsed.push((id, options));
    }
    Ok((workers, parsed))
}

pub(super) fn run_batch(spec_path: &str, cancellation: Arc<Cancellation>) -> Result<i32, String> {
    let started = Instant::now();
    let text = if spec_path == "-" {
        let mut s = String::new();
        std::io::Read::read_to_string(&mut std::io::stdin().lock(), &mut s)
            .map_err(|e| e.to_string())?;
        s
    } else {
        std::fs::read_to_string(spec_path).map_err(|e| format!("{spec_path}: {e}"))?
    };
    let spec: Value = serde_json::from_str(&text).map_err(|e| format!("batch JSON: {e}"))?;
    let (workers, jobs) = parse_batch(&spec, &cancellation)?;
    if spec_path != "-" {
        listen_stdin(cancellation.clone());
    }
    emit(
        json!({"event":"batch","jobs":jobs.len(),"workers":workers}),
        "*",
    );
    for (id, options) in &jobs {
        emit(
            json!({"event":"queued","source":options.source.to_string_lossy()}),
            id,
        );
    }
    let queue = Mutex::new(jobs.into_iter().collect::<VecDeque<_>>());
    let outcomes: Mutex<Vec<Value>> = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let next = queue.lock().unwrap().pop_front();
                let Some((id, options)) = next else { break };
                let outcome = match run_job(&id, &options) {
                    Ok(pointer) => json!({"job":id,"status":"ready","pointer":pointer}),
                    Err(error) => {
                        let mut v = error_value(&error);
                        v["job"] = json!(id);
                        v
                    }
                };
                outcomes.lock().unwrap().push(outcome);
            });
        }
    });
    let mut outcomes = outcomes.into_inner().unwrap();
    outcomes.sort_by(|a, b| a["job"].as_str().cmp(&b["job"].as_str()));
    let ready = outcomes.iter().filter(|o| o["status"] == "ready").count();
    let cancelled = outcomes.iter().filter(|o| o["code"] == "CANCELLED").count();
    let failed = outcomes.len() - ready - cancelled;
    emit(
        json!({"event":"done","completed":ready,"failed":failed,"cancelled":cancelled,"ms":elapsed_ms(started)}),
        "*",
    );
    let status = if failed == 0 && cancelled == 0 {
        "ready"
    } else if ready > 0 {
        "partial"
    } else {
        "failed"
    };
    println!(
        "{}",
        json!({"status":status,"completed":ready,"failed":failed,"cancelled":cancelled,"jobs":outcomes})
    );
    Ok(if failed == 0 && cancelled == 0 { 0 } else { 2 })
}
