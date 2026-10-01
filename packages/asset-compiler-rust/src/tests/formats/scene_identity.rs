//! Shared cooked visibility and cache invariants for native scene readers.
use super::*;

pub(super) fn hidden_materials_and_reuse(run: &super::super::golden::GoldenRun, source: &Path) {
    let output = run
        .cache
        .join("native/full")
        .join(run.result["key"].as_str().unwrap());
    let tables = read_json(&output.join("scene-tables.json"));
    assert_eq!(tables["materials"].as_array().unwrap().len(), 2);
    assert!(tables["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["name"] == "hidden" && n["visible"] == false));
    let (mut options, temporary) = golden_options(source, "scene-reused");
    options.cache = run.cache.clone();
    let again = compile(&options, |_| {}).unwrap();
    assert_eq!(again["key"], run.result["key"]);
    let _ = fs::remove_dir_all(temporary);
}
