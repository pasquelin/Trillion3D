//! One scene, one output (#1370): what a run reports of itself — the pages it found already built,
//! its times — stays in its result, so a compile into a cache that already holds the scene's
//! objects writes the same bytes as the first.
use super::reuse::textured;
use super::*;
use std::collections::BTreeMap;

/// Every file under `directory` by its path under `cache`, with its SHA-256; the cache lock,
/// which names no product, left out.
fn fingerprints(directory: &Path, cache: &Path, into: &mut BTreeMap<PathBuf, String>) {
    for entry in fs::read_dir(directory).expect("folder") {
        let path = entry.expect("entry").path();
        if path.is_dir() {
            fingerprints(&path, cache, into);
        } else if path.file_name() != Some(".lock".as_ref()) {
            let name = path
                .strip_prefix(cache)
                .expect("under the cache")
                .to_path_buf();
            into.insert(name, hash(&fs::read(&path).expect("file")));
        }
    }
}

/// The cache's files after a cold compile, then after a warm one — the key folder removed, so the
/// DAG is built again over the objects the first run left — and both results.
fn cold_then_warm() -> (PathBuf, [BTreeMap<PathBuf, String>; 2], [Value; 2]) {
    let (root, options) = textured();
    let cold = compile(&options, |_| {}).expect("cold compile");
    let mut before = BTreeMap::new();
    fingerprints(&options.cache, &options.cache, &mut before);
    let key = cold["key"].as_str().expect("key");
    fs::remove_dir_all(options.key_directory(key)).expect("key folder");
    let warm = compile(&options, |_| {}).expect("warm compile");
    assert!(warm["reused"].is_null(), "the folder is built again");
    let mut after = BTreeMap::new();
    fingerprints(&options.cache, &options.cache, &mut after);
    (root, [before, after], [cold, warm])
}

// Behaviour: a cold and a warm compile of the same scene write the same files, byte for byte.
#[test]
fn a_cold_and_a_warm_compile_write_the_same_bytes() {
    let (root, [cold, warm], _) = cold_then_warm();
    assert!(!cold.is_empty(), "the compile wrote files");
    assert_eq!(cold, warm, "every file, by its SHA-256");
    fs::remove_dir_all(root).expect("cleanup");
}

/// The objects a run found already built and the pages of its scene, over its primitives.
fn reused_and_pages(result: &Value) -> (u64, u64) {
    let primitives = result["primitives"].as_array().expect("primitives");
    primitives.iter().fold((0, 0), |(reused, pages), p| {
        let count = p["pages"].as_array().map_or(0, Vec::len) as u64;
        (
            reused + p["reusedPages"].as_u64().expect("reusedPages"),
            pages + count,
        )
    })
}

// Behaviour: the warm run's result still reports the pages it found already built: both objects
// of every page, its indices and its packed geometry, where the cold run found fewer.
#[test]
fn the_warm_result_reports_the_pages_it_reused() {
    let (root, _, [cold, warm]) = cold_then_warm();
    let (warm_reused, pages) = reused_and_pages(&warm);
    assert!(pages > 0, "the scene has pages");
    assert_eq!(warm_reused, 2 * pages, "every page found already built");
    assert!(
        reused_and_pages(&cold).0 < warm_reused,
        "the cold run built them"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
