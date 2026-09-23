//! V02: final measurements of a job cross the program boundary. The manifest is written
//! before the cache purge: it alone cannot carry them, and a host reading only the
//! pointer must find them there — otherwise the purge is measured nowhere.
mod common;
use common::{compiler, fixture, lines, run_ok};
use serde_json::Value;
use std::fs;

/// Milliseconds of a pointer measurement, refused if missing or not a number.
fn measure(pointer: &Value, name: &str) -> f64 {
    pointer["metrics"][name]
        .as_f64()
        .unwrap_or_else(|| panic!("metric {name} missing from pointer {}", pointer["metrics"]))
}

#[test]
fn v02_le_pointeur_porte_les_mesures_prises_apres_le_manifeste() {
    let (root, obj, cache) = fixture("mesures");
    let output = run_ok(&mut compiler(&obj, &cache));
    let stdout = lines(&String::from_utf8_lossy(&output.stdout));
    let pointer = &stdout[0];
    let (wall, prune) = (measure(pointer, "wallMs"), measure(pointer, "pruneMs"));
    assert!(
        wall >= prune,
        "total duration {wall} ms under purge {prune} ms"
    );
    // The `complete` event carries this same pointer: a host following the stream knows as much.
    let events = lines(&String::from_utf8_lossy(&output.stderr));
    let complete = events
        .iter()
        .rfind(|event| event["event"] == "complete")
        .expect("complete event");
    assert_eq!(complete["pointer"]["metrics"], pointer["metrics"]);
    fs::remove_dir_all(root).ok();
}
