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
    let racines: usize = pages
        .iter()
        .filter(|page| page["parentError"].is_null())
        .map(|page| page["count"].as_u64().expect("count") as usize / 3)
        .sum();
    let niveau_zero: u64 = pages
        .iter()
        .filter(|page| page["level"] == json!(0))
        .map(|page| page["count"].as_u64().expect("count") / 3)
        .sum();
    fs::remove_dir_all(root).expect("cleanup");
    (depth, racines, niveau_zero)
}

// Behaviour: in `none`, the DAG holds on its only level zero, which covers
// exactly the source triangles. No simplified replacement is written, so no coarse root.
#[test]
fn simplification_none_ne_construit_aucun_niveau_grossier() {
    let (depth, racines, niveau_zero) = dag_of("none");
    assert_eq!(depth, 0, "a single level: exact clusters");
    assert_eq!(niveau_zero, 8192, "level zero covers the whole source");
    assert_eq!(
        racines, 8192,
        "exact clusters are the roots: nothing replaces them"
    );
}

// Behaviour: `qem-endpoints` keeps the DAG it used to build — same depth, and no more roots
// than meshoptimizer 0.22 left (127). Under 0.25 the count depends on the platform's last
// floating-point bit (measured: 125 on macOS arm64, 127 on Linux x64), so the test bounds it.
#[test]
fn simplification_qem_endpoints_garde_son_dag() {
    let (depth, racines, niveau_zero) = dag_of("qem-endpoints");
    assert_eq!(depth, 6, "depth unchanged");
    assert_eq!(niveau_zero, 8192, "level zero covers the whole source");
    assert!(
        (125..=127).contains(&racines),
        "root within the measured platform spread: {racines}"
    );
}
