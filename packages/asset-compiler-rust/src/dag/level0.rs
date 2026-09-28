//! Level 0 of the DAG: the source triangles themselves, in clusters.
use super::*;

/// The source triangles in clusters, each ranked by the earliest source triangle it holds, which
/// keeps a transparent draw order close to the source's.
pub(super) fn level_zero(positions: &[f32], indices: &[u32]) -> Result<Vec<DagCluster>> {
    // Rank of the source triangle each vertex first appears in, used to keep the draw order stable.
    let mut first_use = vec![u32::MAX; positions.len() / 3];
    for (offset, &vertex) in indices.iter().enumerate() {
        let slot = vertex as usize;
        if slot < first_use.len() && first_use[slot] == u32::MAX {
            first_use[slot] = (offset / 3) as u32;
        }
    }
    let mut dag = Vec::new();
    let level0 = {
        let _t = Timer::new(Phase::ClusterLevel0);
        cluster_triangles(positions, indices, DAG_CLUSTER_TRIANGLES)?
    };
    for cluster in level0 {
        let sphere = bounding_sphere(positions, &cluster);
        let source_rank = cluster
            .iter()
            .map(|&v| first_use.get(v as usize).copied().unwrap_or(u32::MAX))
            .min()
            .unwrap_or(0);
        dag.push(DagCluster {
            indices: cluster,
            level: 0,
            lod_error: 0.0,
            parent_error: f64::INFINITY,
            sphere,
            parent_sphere: sphere,
            replacement: None,
            source_rank,
            group: None,
            source: None,
        });
    }
    Ok(dag)
}
