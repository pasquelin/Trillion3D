//! Warnings of a primitive's DAG: a DAG that did not rise is never published in
//! silence. The reference does not let a mesh without a root go out — the coarsest
//! level is what draws in the distance — and on 18 Sept. 2026 a scene went out
//! with 70 primitives of 101 without any coarse level, all counted in
//! `clusters.json` and nothing said.
use super::*;

/// Page share beyond which the roots of a primitive of at least `DAG_GROUP_MIN`
/// clusters say a DAG stopped mid-way. Eight clusters that rise to one root make
/// fifteen pages of which one is a root (7 %); the same DAG stopped after its
/// first level makes twelve of which four (33 %). An eighth sits between the two.
const DAG_ROOT_SHARE: usize = 8;

/// One published row per DAG level: clusters, triangles, roots, errors.
pub(super) fn level_report(dag: &[crate::dag::DagCluster], depth: usize) -> Vec<Value> {
    let mut stats = Vec::new();
    for level in 0..=depth {
        let mut errors: Vec<f64> = Vec::new();
        let mut triangles = 0usize;
        let mut roots = 0usize;
        for cluster in dag.iter().filter(|c| c.level == level) {
            errors.push(cluster.lod_error);
            triangles += cluster.triangles();
            roots += usize::from(cluster.is_root());
        }
        if errors.is_empty() {
            continue;
        }
        let clusters = errors.len();
        let (min, median, max) = super::compiler_primitive_dag::level_error_stats(&mut errors);
        stats.push(json!({"level":level,"clusters":clusters,"triangles":triangles,"roots":roots,"errorMin":min,"errorMedian":median,"errorMax":max}));
    }
    stats
}

/// The four numbers a warning judges, read once on the DAG.
pub(super) struct DagShape {
    pub level0: usize,
    pub depth: usize,
    pub pages: usize,
    pub roots: usize,
}
impl DagShape {
    pub fn of(dag: &[crate::dag::DagCluster]) -> Self {
        Self {
            level0: dag.iter().filter(|c| c.level == 0).count(),
            depth: dag.iter().map(|c| c.level).max().unwrap_or(0),
            pages: dag.len(),
            roots: dag.iter().filter(|c| c.is_root()).count(),
        }
    }
}

/// Les avertissements d'une primitive, ou aucun. `groups` compte les groupes par issue.
pub(super) fn dag_warnings(
    strategy: crate::dag::DagStrategy,
    shape: &DagShape,
    tallies: &[crate::dag::GroupTally],
) -> Vec<Value> {
    let DagShape {
        level0,
        depth,
        pages,
        roots,
    } = *shape;
    if strategy == crate::dag::DagStrategy::ExactClusters || level0 < 2 {
        return Vec::new();
    }
    let code = if depth == 0 {
        "DAG_FLAT"
    } else if level0 >= crate::dag::DAG_GROUP_MIN && roots * DAG_ROOT_SHARE > pages {
        "DAG_ROOTS"
    } else {
        return Vec::new();
    };
    vec![json!({
        "code": code,
        "roots": roots,
        "pages": pages,
        "groups": crate::dag::GroupTally::total(tallies).json(),
    })]
}

/// Progress event of a compiled primitive. A DAG that did not rise is told in the
/// log, not only in `clusters.json`: its warnings travel with the event.
pub(super) fn primitive_event(
    mesh: usize,
    primitive: usize,
    pages: usize,
    warnings: &[Value],
) -> Value {
    let mut event = json!({"phase":"primitive","mesh":mesh,"primitive":primitive,"pages":pages});
    if !warnings.is_empty() {
        event["warnings"] = json!(warnings);
    }
    event
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dag::{DagStrategy, GroupTally};

    fn stalled(no_collapse: usize) -> GroupTally {
        GroupTally {
            no_collapse,
            ..GroupTally::default()
        }
    }
    fn warn(
        level0: usize,
        depth: usize,
        pages: usize,
        roots: usize,
        t: &[GroupTally],
    ) -> Vec<Value> {
        let shape = DagShape {
            level0,
            depth,
            pages,
            roots,
        };
        dag_warnings(DagStrategy::QemEndpoints, &shape, t)
    }

    // Behaviour: a primitive of several clusters left at depth 0 is named, with
    // the group count per outcome; requested exact clusters (`none`) are not one.
    #[test]
    fn une_primitive_sans_niveau_grossier_est_un_avertissement_nomme() {
        let warnings = warn(98, 0, 98, 98, &[stalled(4)]);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0]["code"], "DAG_FLAT");
        assert_eq!(warnings[0]["groups"]["noCollapse"], 4);
        assert_eq!(warnings[0]["roots"], 98);
        let exact = DagShape {
            level0: 98,
            depth: 0,
            pages: 98,
            roots: 98,
        };
        assert!(dag_warnings(DagStrategy::ExactClusters, &exact, &[]).is_empty());
        assert!(warn(1, 0, 1, 1, &[]).is_empty());
    }

    // Behaviour: too many roots on a primitive of at least eight clusters is a
    // warning, a single root on fifteen pages is not one, and a small primitive is not judged.
    #[test]
    fn trop_de_racines_est_un_avertissement_au_dela_du_huitieme_des_pages() {
        let ok = warn(8, 3, 15, 1, &[]);
        assert!(ok.is_empty(), "{ok:?}");
        let stopped = warn(8, 1, 12, 4, &[stalled(1)]);
        assert_eq!(stopped[0]["code"], "DAG_ROOTS");
        assert!(warn(4, 1, 6, 2, &[]).is_empty());
    }
}
