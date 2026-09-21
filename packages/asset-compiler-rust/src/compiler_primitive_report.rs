use super::*;

/// The culling hierarchy as the manifest carries it: a flat node array, `CULLING_STRIDE`
/// numbers per node, `-1` marking a subtree that holds a root.
pub(super) fn culling_report(culling: &[crate::dag::CullingNode]) -> Value {
    // Flat node array, CULLING_STRIDE numbers per node; -1 marks a subtree holding a root.
    let mut flat = Vec::with_capacity(culling.len() * CULLING_STRIDE);
    for node in culling {
        for a in 0..3 {
            flat.push(json!(node.min[a]));
        }
        for a in 0..3 {
            flat.push(json!(node.max[a]));
        }
        for a in 0..4 {
            flat.push(json!(node.sphere[a]));
        }
        flat.push(if node.max_parent_error.is_finite() {
            json!(node.max_parent_error)
        } else {
            json!(-1.0)
        });
        flat.push(json!(node.first_child));
        flat.push(json!(node.child_count));
        flat.push(json!(node.first_cluster));
        flat.push(json!(node.cluster_count));
    }
    json!({"stride":CULLING_STRIDE,"count":culling.len(),"nodes":flat})
}
