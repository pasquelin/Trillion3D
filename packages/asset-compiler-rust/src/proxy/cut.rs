use crate::dag::DagCluster;

/// Clusters of a flat cut at the given threshold: certified error under the
/// threshold, replacement above.
///
/// Exactly the cut engine uses for screen, threshold in meters instead of pixels:
/// `lod_error <= t < parent_error`. Both monotonic along DAG, so rule
/// covers surface once and once only — no hole, no double layer. A root has infinite
/// `parent_error`: retained as soon as error exceeds threshold, otherwise
/// children are retained because replacement is precisely this coarse root.
pub(crate) fn selected(cluster: &DagCluster, threshold: f64) -> bool {
    in_cut(cluster.lod_error, cluster.parent_error, threshold)
}

/// The cut rule on a cluster's own and parent errors, for a reader of published pages.
pub(crate) fn in_cut(lod_error: f64, parent_error: f64, threshold: f64) -> bool {
    lod_error <= threshold && parent_error > threshold
}
