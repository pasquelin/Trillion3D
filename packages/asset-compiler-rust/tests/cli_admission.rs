//! A15 — l'admission d'un lot tient dans le budget annoncé. Ce que ces épreuves tiennent : la
//! concurrence admise multipliée par la part d'un travail ne dépasse jamais le budget total, et un
//! travail qui réclame à lui seul plus que le lot entier est refusé avant que rien ne commence.
mod common;
use common::{fixture, lines};
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

/// Lance un lot décrit par `spec` et rend ses événements puis sa ligne de sortie.
fn run_batch(root: &Path, spec: Value) -> (Vec<Value>, Value) {
    let path = root.join("jobs.json");
    fs::write(&path, spec.to_string()).expect("spec");
    let output = Command::new(env!("CARGO_BIN_EXE_web-geometry-compiler"))
        .args(["--jobs", path.to_str().expect("chemin")])
        .stdin(Stdio::null())
        .output()
        .expect("lot");
    let printed = lines(&String::from_utf8_lossy(&output.stdout));
    assert_eq!(printed.len(), 1, "une seule ligne de sortie");
    (
        lines(&String::from_utf8_lossy(&output.stderr)),
        printed[0].clone(),
    )
}
/// La part de mémoire que chaque travail s'est vu accorder à son admission.
fn accepted_shares(events: &[Value]) -> Vec<u64> {
    events
        .iter()
        .filter(|e| e["event"] == "accepted")
        .map(|e| e["ramBudgetMb"].as_u64().expect("ramBudgetMb"))
        .collect()
}

// Comportement : deux travaux de front sous un budget total de 64 Mio, c'est 128 Mio admis. Le lot
// doit donc réduire sa concurrence — un travail à la fois — plutôt qu'accorder deux fois le total.
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
    assert_eq!(shares.len(), 2, "les deux travaux sont admis");
    let largest = shares.iter().copied().max().expect("part");
    assert!(
        workers * largest <= 64,
        "{workers} travaux de front à {largest} Mio sous un budget de 64 Mio"
    );
    fs::remove_dir_all(root).ok();
}

// Comportement : un travail qui réclame à lui seul plus que le budget du lot ne peut jamais tenir.
// Le lot est refusé avant le premier travail, et le refus nomme le travail et les deux chiffres.
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
    assert!(!cache.join("a").exists(), "aucun travail n'a commencé");
    fs::remove_dir_all(root).ok();
}
