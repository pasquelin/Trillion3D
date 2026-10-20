//! `simplification = none` promises exact clusters and nothing else. What
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

// Behaviour: `qem-endpoints` climbs to one root cluster: the simplifier always reaches its
// target, so no group stalls and the DAG ends on a single cluster, at most 128 triangles. Each
// level halves the 64 level-zero clusters at best, so it takes at least six levels.
#[test]
fn simplification_qem_endpoints_keeps_its_dag() {
    let (depth, roots, level_zero) = dag_of("qem-endpoints");
    assert!(depth >= 6, "depth {depth}: a level halves at best");
    assert_eq!(level_zero, 8192, "level zero covers the whole source");
    assert!(
        roots <= 128,
        "{roots} root triangles: more than one cluster"
    );
}
