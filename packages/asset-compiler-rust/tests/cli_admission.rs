//! A15 — batch admission stays within the announced budget. What these tests verify:
//! admitted concurrency multiplied by a job's allocation never exceeds total budget, and a
//! job requiring more than the entire batch budget by itself is refused before anything starts.
mod common;
use common::{fixture, lines};
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

/// Launches a batch described by `spec` and returns its events then its output line.
fn run_batch(root: &Path, spec: Value) -> (Vec<Value>, Value) {
    let path = root.join("jobs.json");
    fs::write(&path, spec.to_string()).expect("spec");
    let output = Command::new(env!("CARGO_BIN_EXE_web-geometry-compiler"))
        .args(["--jobs", path.to_str().expect("path")])
        .stdin(Stdio::null())
        .output()
        .expect("batch");
    let printed = lines(&String::from_utf8_lossy(&output.stdout));
    assert_eq!(printed.len(), 1, "single output line");
    (
        lines(&String::from_utf8_lossy(&output.stderr)),
        printed[0].clone(),
    )
}
/// Memory allocation granted to each job upon admission.
fn accepted_shares(events: &[Value]) -> Vec<u64> {
    events
        .iter()
        .filter(|e| e["event"] == "accepted")
        .map(|e| e["ramBudgetMb"].as_u64().expect("ramBudgetMb"))
        .collect()
}

// Behavior: two concurrent jobs allocated 64 MiB under a total budget of 64 MiB equals 128 MiB total.
// The batch must reduce its concurrency — one job at a time — rather than granting twice the total.
#[test]
fn a15_la_concurrence_admise_tient_dans_le_budget_total() {
    let (root, obj, cache) = fixture("admission-total");
    let (events, summary) = run_batch(
        &root,
        json!({"workers":2,"ramBudgetMb":64,"jobs":[
            {"id":"a","source":obj,"cache":cache.join("a"),"resourceBaseUrl":"/a/"},
            {"id":"b","source":obj,"cache":cache.join("b"),"resourceBaseUrl":"/b/"}]}),
    );
    assert_eq!(summary["status"], "ready", "{summary}");
    let batch = events
        .iter()
        .find(|e| e["event"] == "batch")
        .expect("batch");
    let workers = batch["workers"].as_u64().expect("workers");
    let shares = accepted_shares(&events);
    assert_eq!(shares.len(), 2, "both jobs are admitted");
    let largest = shares.iter().copied().max().expect("share");
    assert!(
        workers * largest <= 64,
        "{workers} concurrent jobs at {largest} MiB under a 64 MiB budget"
    );
    fs::remove_dir_all(root).ok();
}

// Behavior: a job requiring more than the batch budget by itself can never fit.
// The batch is refused before the first job, and refusal names the job and both figures.
#[test]
fn a15_un_travail_plus_gourmand_que_le_lot_est_refuse() {
    let (root, obj, cache) = fixture("admission-travail");
    let (_, summary) = run_batch(
        &root,
        json!({"workers":1,"ramBudgetMb":256,"jobs":[
            {"id":"enorme","source":obj,"cache":cache.join("a"),"resourceBaseUrl":"/a/","ramBudgetMb":4096}]}),
    );
    assert_eq!(summary["status"], "error", "{summary}");
    assert_eq!(summary["code"], "INVALID_BATCH", "{summary}");
    let message = summary["message"].as_str().expect("message");
    assert!(message.contains("enorme"), "{message}");
    assert!(
        message.contains("4096") && message.contains("256"),
        "{message}"
    );
    assert!(!cache.join("a").exists(), "no work has started");
    fs::remove_dir_all(root).ok();
}
