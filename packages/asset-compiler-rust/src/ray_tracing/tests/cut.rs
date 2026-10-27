//! The cut of the DAG holds the clusters the error falls in, and the error is a share of the size
//! of the finest clusters.
use super::cluster;
use crate::dag::DagCluster;
use crate::ray_tracing::cut::{cut_clusters, cut_of, error_of, FALLBACK_RELATIVE_ERROR};

#[test]
fn the_cut_holds_the_clusters_the_error_falls_in() {
    let infinite = f64::INFINITY;
    // Four finest clusters, two made from them in pairs, a root made from those.
    let mut dag: Vec<DagCluster> = (0..4)
        .map(|_| cluster(vec![0, 1, 2], (0.0, 1.0), false))
        .collect();
    dag.extend((0..2).map(|_| cluster(vec![0, 1, 2], (1.0, 3.0), true)));
    dag.push(cluster(vec![0, 1, 2], (3.0, infinite), true));
    let ranks = |error: f32| cut_clusters(&dag, error).collect::<Vec<_>>();
    assert_eq!(ranks(0.5), [0, 1, 2, 3]);
    // The error of a cluster is its own: a group whose error equals it has replaced the finer.
    assert_eq!(ranks(1.0), [4, 5]);
    assert_eq!(ranks(2.0), [4, 5]);
    assert_eq!(ranks(3.0), [6]);
    assert_eq!(ranks(100.0), [6]);
}

#[test]
fn the_error_is_a_share_of_the_size_of_the_finest_clusters() {
    // A unit square of two triangles: its area is 1, the surface of its box 2.
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [
        cluster(vec![0, 1, 2, 0, 2, 3], (0.0, 1.0), false),
        // A coarser cluster is not measured.
        cluster(vec![0, 1, 3], (1.0, f64::INFINITY), true),
    ];
    let expected = FALLBACK_RELATIVE_ERROR * 0.01 * 2f32.sqrt();
    assert!((error_of(&positions, &dag) - expected).abs() < 1e-7);
    let cut = cut_of(&positions, &dag);
    assert_eq!(cut.triangles.len(), 2);
    assert_eq!(cut.triangles[1].triangle, 1);
    assert_eq!(cut.triangles[1].corners[1], [1.0, 1.0, 0.0]);
}
