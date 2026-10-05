use super::*;

/// Clusters, kept groups, one tally per level, the stalled groups with their level, and the arrays
/// grown with every vertex a seam-locked solve placed (`Grown`).
pub type DagBuild = (
    Vec<DagCluster>,
    Vec<DagGroup>,
    Vec<GroupTally>,
    Vec<DagStall>,
    Option<Grown>,
);

/// Builds cluster DAG. `strategy` decides whether coarse levels exist: in
/// `ExactClusters` build yields level zero alone, without group or reduction, so
/// published coverage is exactly source triangles.
///
/// `attributes` — the normals and every texture set the pages carry — count in the reduction
/// error; a position written under several texture coordinates is a seam no collapse crosses.
///
/// Returns the clusters, the groups kept, one tally per level and every stalled group with its
/// level, in level order.
pub fn build_dag_tallied(
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
            source_rank,
            group: None,
            source: None,
        });
    }
    // Welding is only used for reduction: nothing to weld for exact clusters or for a primitive fitting in a single cluster.
    let (mut dag, mut groups, tallies, stalls, grown) =
        if strategy == DagStrategy::ExactClusters || dag.len() < 2 {
            (dag, Vec::new(), Vec::new(), Vec::new(), None)
        } else {
            super::levels::coarsen(positions, attributes, indices, dag, checkpoint)?
        };
    // A primitive's spheres are tightened once its DAG is built; the super-roots' below keep the
    // spheres their roots were published at, which a parent's sphere must hold. Only level 0 is
    // read from the positions: placed vertices lie above it.
    tight::tighten(&mut dag, &mut groups, positions);
    Ok((dag, groups, tallies, stalls, grown))
}

/// Continues the DAG above clusters that already exist: the root clusters of placed objects, in
/// world space, each with the error and the sphere it was published at (`compiler_world_roots`,
/// #23): a parent's sphere then holds the published one, never a tighter sphere of the triangles.
/// Level 0 is those clusters as given, in order; the levels above them are built exactly as a primitive's,
/// with the same grouping, the same simplification and the same monotone error. Positions only:
/// the super-roots carry no attribute.
pub fn build_dag_from_roots(
    positions: &[f32],
    roots: Vec<(Vec<u32>, f64, [f64; 4])>,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    checkpoint()?;
    let indices: Vec<u32> = roots.iter().flat_map(|(c, ..)| c.iter().copied()).collect();
    let dag: Vec<DagCluster> = roots
        .into_iter()
        .enumerate()
        .map(|(rank, (indices, lod_error, sphere))| DagCluster {
            indices,
            level: 0,
            lod_error,
            parent_error: f64::INFINITY,
            sphere,
            parent_sphere: sphere,
            source_rank: rank as u32,
            group: None,
            source: None,
        })
        .collect();
    if dag.len() < 2 {
        return Ok((dag, Vec::new(), Vec::new(), Vec::new(), None));
    }
    let attributes = DagAttributes::default();
    super::levels::coarsen(positions, attributes, &indices, dag, checkpoint)
}
