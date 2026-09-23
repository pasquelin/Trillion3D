//! A02: two writes to the same cache in a batch. A cache only keeps one pointer per scope and
//! purges after each job: two jobs targeting it erase each other.
mod common;
use common::fixture;
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

fn run_batch(spec_path: &Path) -> (Option<i32>, Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_web-geometry-compiler"))
        .args(["--jobs", spec_path.to_str().expect("path")])
        .stdin(Stdio::null())
        .output()
        .expect("run");
    let summary =
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).expect("JSON summary");
    (output.status.code(), summary)
}
fn write_spec(spec_path: &Path, obj: &Path, first: &Path, second: &Path) {
    fs::write(
        spec_path,
        json!({"workers":1,"ramBudgetMb":256,"jobs":[
            {"id":"premier","source":obj,"cache":first,"resourceBaseUrl":"/a/"},
            {"id":"second","source":obj,"cache":second,"resourceBaseUrl":"/b/"}]})
        .to_string(),
    )
    .expect("spec");
}
/// Refusal names both entries in the batch so the host knows which ones to merge.
fn assert_alias_refused(code: Option<i32>, summary: &Value) {
    assert_eq!(code, Some(2), "{summary}");
    assert_eq!(summary["code"], "INVALID_BATCH", "{summary}");
    let message = summary["message"].as_str().unwrap_or_default();
    assert!(
        message.contains("premier") && message.contains("second"),
        "{message}"
    );
}

/// A02: `x` and `p/../x` refer to the same missing folder. `canonicalize` failed on a missing
/// path, raw text then served as identity and both jobs were admitted.
#[test]
fn a02_two_writes_of_the_same_absent_cache_are_refused() {
    let (root, obj, cache) = fixture("alias-absent");
    let spec = root.join("jobs.json");
    write_spec(
        &spec,
        &obj,
        &cache.join("alias-output"),
        &cache.join("alias-parent/../alias-output"),
    );
    let (code, summary) = run_batch(&spec);
    assert_alias_refused(code, &summary);
    fs::remove_dir_all(root).ok();
}
/// A02: the same pair, but the folders already exist before the batch.
#[test]
fn a02_two_writes_of_the_same_existing_cache_are_refused() {
    let (root, obj, cache) = fixture("alias-existant");
    let direct = cache.join("alias-output");
    fs::create_dir_all(cache.join("alias-parent")).expect("parent");
    fs::create_dir_all(&direct).expect("cache");
    let spec = root.join("jobs.json");
    write_spec(
        &spec,
        &obj,
        &direct,
        &cache.join("alias-parent/../alias-output"),
    );
    let (code, summary) = run_batch(&spec);
    assert_alias_refused(code, &summary);
    fs::remove_dir_all(root).ok();
}
/// A02: an existing symbolic link to another job's cache is the same alias.
#[cfg(unix)]
#[test]
fn a02_a_symlink_to_the_same_cache_is_refused() {
    let (root, obj, cache) = fixture("alias-lien");
    let direct = cache.join("alias-output");
    fs::create_dir_all(&direct).expect("cache");
    let link = cache.join("alias-link");
    std::os::unix::fs::symlink(&direct, &link).expect("lien");
    let spec = root.join("jobs.json");
    write_spec(&spec, &obj, &direct, &link);
    let (code, summary) = run_batch(&spec);
    assert_alias_refused(code, &summary);
    fs::remove_dir_all(root).ok();
}
