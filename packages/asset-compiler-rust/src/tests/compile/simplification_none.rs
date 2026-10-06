//! A03 — `simplification = none` promises exact clusters and nothing else. What
//! the DAG builds above level zero is not an optimisation: it is geometry the
//! source does not have.
use super::*;

/// DAG of the same grid, compiled in a given mode: depth, root triangles, and
/// triangle count carried by level zero.
fn dag_of(mode: &str) -> (u64, usize, u64) {
    let (root, mut options) = grid_fixture_displaced(64, 64, 3.0);
    options.simplification = mode.into();
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(
        result["simplification"],
        json!(mode != "none"),
        "the manifest announces the requested mode"
    );
    let primitive = &result["primitives"][0];
    let depth = primitive["dag"]["depth"].as_u64().expect("depth");
    let pages = primitive["pages"].as_array().expect("pages");
    let roots: usize = pages
        .iter()
        .filter(|page| page["parentError"].is_null())
        .map(|page| page["count"].as_u64().expect("count") as usize / 3)
        .sum();
    let level_zero: u64 = pages
        .iter()
        .filter(|page| page["level"] == json!(0))
        .map(|page| page["count"].as_u64().expect("count") / 3)
        .sum();
    fs::remove_dir_all(root).expect("cleanup");
    (depth, roots, level_zero)
}

// Behaviour: in `none`, the DAG holds on its only level zero, which covers
// exactly the source triangles. No simplified replacement is written, so no coarse root.
#[test]
fn simplification_none_builds_no_coarse_level() {
    let (depth, roots, level_zero) = dag_of("none");
    assert_eq!(depth, 0, "a single level: exact clusters");
    assert_eq!(level_zero, 8192, "level zero covers the whole source");
    assert_eq!(
        roots, 8192,
        "exact clusters are the roots: nothing replaces them"
    );
}

// Behaviour: `qem-endpoints` keeps the DAG it used to build, and never leaves more roots than the
// 127 of the simplifier's older version. Under 0.25 (`meshopt` 0.6) the count depends on the machine: 125 on
// aarch64, 127 on x86_64, the simplifier's floating-point results differing between the two. The
// depth and the exact level-zero cover are the same everywhere.
#[test]
fn simplification_qem_endpoints_keeps_its_dag() {
    let (depth, roots, level_zero) = dag_of("qem-endpoints");
    assert_eq!(depth, 6, "depth unchanged");
    assert_eq!(level_zero, 8192, "level zero covers the whole source");
    assert!(
        roots <= 127,
        "{roots} roots, more than the simplifier's older version left"
    );
}
