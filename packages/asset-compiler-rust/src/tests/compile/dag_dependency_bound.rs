//! The dependency bound of a bundle: a bundle whose parents would span more bundles than the
//! bound is split while packing, and a cluster whose own parents exceed a forced bound is refused.
use super::dag_dependencies::{cluster, group, pack};
use super::*;
use crate::dag::{DagCluster, DagGroup};

/// Two roots, each replacing two 48 KiB clusters — a group of 96 KiB, one bundle each —, each of
/// those over a group of four 8 KiB children: the sixteen children fill one 128 KiB bundle exactly,
/// whose parents would then span both level-1 bundles.
fn straddling_family() -> (Vec<DagCluster>, Vec<DagGroup>, Vec<usize>) {
    let mut dag = vec![cluster(2, 3, None, Some(0)), cluster(2, 3, None, Some(1))];
    let mut groups = vec![group(2, vec![2, 3], vec![0]), group(2, vec![4, 5], vec![1])];
    for parent in 0..4 {
        dag.push(cluster(1, 12 * 1024, Some(parent / 2), Some(2 + parent)));
        groups.push(group(
            1,
            (0..4).map(|k| 6 + parent * 4 + k).collect(),
            vec![2 + parent],
        ));
    }
    for child in 0..16 {
        dag.push(cluster(0, 2 * 1024, Some(2 + child / 4), None));
    }
    let order = (0..dag.len()).collect();
    (dag, groups, order)
}

#[test]
fn a_bundle_that_would_exceed_the_bound_is_split_before_packing_ends() {
    let (dag, groups, order) = straddling_family();
    let bound = dependency_bound(&dag, &groups);
    assert_eq!(bound, 1, "every cluster has one parent");
    let fine = |bound: usize| {
        let (bundles, _, bundle_of) = pack(&dag, &groups, &order, bound).expect("packed");
        let direct = direct_dependencies(&dag, &groups, &bundle_of, bundles.len());
        direct[bundle_of[6]..]
            .iter()
            .map(Vec::len)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        fine(usize::MAX),
        vec![2],
        "by size alone, one bundle needs two"
    );
    assert_eq!(
        fine(bound),
        vec![1, 1],
        "held to the bound, it is split in two"
    );
}

#[test]
fn a_cluster_whose_parents_exceed_a_forced_bound_is_refused_with_the_page_named() {
    // Two 96 KiB level-1 clusters, each its root's group, cannot share a bundle; the one fine
    // cluster has both as parents.
    let dag = vec![
        cluster(2, 3, None, Some(0)),
        cluster(2, 3, None, Some(1)),
        cluster(1, 24 * 1024, Some(0), Some(2)),
        cluster(1, 24 * 1024, Some(1), Some(2)),
        cluster(0, 3, Some(2), None),
    ];
    let groups = vec![
        group(2, vec![2], vec![0]),
        group(2, vec![3], vec![1]),
        group(1, vec![4], vec![2, 3]),
    ];
    assert_eq!(dependency_bound(&dag, &groups), 2);
    assert!(pack(&dag, &groups, &[0, 1, 2, 3, 4], 2).is_ok());
    let error = pack(&dag, &groups, &[0, 1, 2, 3, 4], 1).expect_err("refused");
    assert_eq!(error.code, "PAGE_DEPENDENCY_BOUND");
    assert!(error.message.contains("Page 4"), "{error}");
}
