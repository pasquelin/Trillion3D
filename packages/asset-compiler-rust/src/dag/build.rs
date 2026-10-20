use super::*;

impl DagCluster {
    /// A level-0 cluster in no group yet: a root of its own, `sphere` bounding both its error and
    /// its parent's.
    pub(crate) fn leaf(
        indices: Vec<u32>,
        lod_error: f64,
        sphere: [f64; 4],
        source_rank: u32,
    ) -> Self {
        Self {
            indices,
            level: 0,
            lod_error,
            parent_error: f64::INFINITY,
            sphere,
            parent_sphere: sphere,
            source_rank,
            group: None,
            source: None,
        }
    }
}

/// A built DAG: its clusters, the groups kept, one tally per level, the stalled groups with their
/// level, and the arrays grown with every vertex a solve placed (`Grown`).
pub struct DagBuild {
    pub clusters: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub tallies: Vec<GroupTally>,
    pub stalls: Vec<DagStall>,
    pub grown: Option<Grown>,
}

/// Builds cluster DAG. `strategy` decides whether coarse levels exist: in
/// `ExactClusters` build yields level zero alone, without group or reduction, so
/// published coverage is exactly source triangles.
///
/// `attributes` — the normals and every texture set the pages carry — count in the reduction
/// error; a position written under several texture coordinates is a seam no collapse crosses.
///
/// Returns the clusters, the groups kept, one tally per level and every stalled group with its
/// level, in level order (`DagBuild`).
pub fn build_dag(
    positions: &[f32],
    attributes: DagAttributes,
    indices: &[u32],
    strategy: DagStrategy,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    checkpoint()?;
    // The seam weld's key holds the two texture sets a page can carry, no more.
    if attributes.uv_sets().len() > 2 {
        return Err(invalid("a page carries at most two texture sets"));
    }
    // Rank of the source triangle each vertex first appears in, used to keep the draw order stable.
    let mut first_use = vec![u32::MAX; positions.len() / 3];
    for (offset, &vertex) in indices.iter().enumerate() {
        let slot = vertex as usize;
        if slot < first_use.len() && first_use[slot] == u32::MAX {
            first_use[slot] = (offset / 3) as u32;
        }
    }
    let mut dag: Vec<DagCluster> = Vec::new();
    let level0 = {
        let _t = Timer::new(Phase::ClusterLevel0);
        cluster_triangles(positions, indices, DAG_CLUSTER_TRIANGLES)?
    };
    for cluster in level0 {
        let sphere = point_sphere(positions, &cluster);
        let source_rank = cluster
            .iter()
            .map(|&v| first_use.get(v as usize).copied().unwrap_or(u32::MAX))
            .min()
            .unwrap_or(0);
        dag.push(DagCluster::leaf(cluster, 0.0, sphere, source_rank));
    }
    // Welding is only used for reduction: nothing to weld for exact clusters or for a primitive fitting in a single cluster.
    let mut build = if strategy == DagStrategy::ExactClusters || dag.len() < 2 {
        DagBuild {
            clusters: dag,
            groups: Vec::new(),
            tallies: Vec::new(),
            stalls: Vec::new(),
            grown: None,
        }
    } else {
        super::levels::coarsen(positions, attributes, indices, dag, checkpoint)?
    };
    // The encoder's vertex cap, once every level is built: the partition never read it.
    constrain_wide(&mut build.clusters, &mut build.groups);
    Ok(build)
}
