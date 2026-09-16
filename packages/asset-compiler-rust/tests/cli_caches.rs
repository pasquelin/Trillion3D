//! A02 : deux écritures d'un même cache dans un lot. Un cache ne garde qu'un pointeur par scope et
//! se purge après chaque travail : deux travaux qui le visent s'effacent l'un l'autre.
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
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).expect("résumé JSON");
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
/// Le refus nomme les deux entrées du lot pour que l'hôte sache lesquelles fusionner.
fn assert_refus_alias(code: Option<i32>, summary: &Value) {
    assert_eq!(code, Some(2), "{summary}");
    assert_eq!(summary["code"], "INVALID_BATCH", "{summary}");
    let message = summary["message"].as_str().unwrap_or_default();
    assert!(
        message.contains("premier") && message.contains("second"),
        "{message}"
    );
}

/// A02 : `x` et `p/../x` désignent le même dossier absent. `canonicalize` échouait sur un chemin
/// absent, le texte brut servait alors d'identité et les deux travaux étaient admis.
#[test]
fn a02_deux_ecritures_du_meme_cache_absent_sont_refusees() {
    let (root, obj, cache) = fixture("alias-absent");
    let spec = root.join("jobs.json");
    write_spec(
        &spec,
        &obj,
        &cache.join("alias-output"),
        &cache.join("alias-parent/../alias-output"),
    );
    let (code, summary) = run_batch(&spec);
    assert_refus_alias(code, &summary);
    fs::remove_dir_all(root).ok();
}
/// A02 : la même paire, mais les dossiers existent déjà avant le lot.
#[test]
fn a02_deux_ecritures_du_meme_cache_existant_sont_refusees() {
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
    assert_refus_alias(code, &summary);
    fs::remove_dir_all(root).ok();
}
/// A02 : un lien symbolique existant vers le cache d'un autre travail est le même alias.
#[cfg(unix)]
#[test]
fn a02_un_lien_symbolique_vers_le_meme_cache_est_refuse() {
    let (root, obj, cache) = fixture("alias-lien");
    let direct = cache.join("alias-output");
    fs::create_dir_all(&direct).expect("cache");
    let link = cache.join("alias-link");
    std::os::unix::fs::symlink(&direct, &link).expect("lien");
    let spec = root.join("jobs.json");
    write_spec(&spec, &obj, &direct, &link);
    let (code, summary) = run_batch(&spec);
    assert_refus_alias(code, &summary);
    fs::remove_dir_all(root).ok();
}
