use super::*;

/// Clusters, kept groups, one tally per level, and the stalled groups with their level.
pub type DagBuild = (
    Vec<DagCluster>,
    Vec<DagGroup>,
    Vec<GroupTally>,
    Vec<DagStall>,
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
            replacement: None,
            source_rank,
            group: None,
            source: None,
        });
    }
    let mut tallies: Vec<GroupTally> = Vec::new();
    let mut stalls: Vec<DagStall> = Vec::new();
    let mut reductions_kept: Vec<DagGroup> = Vec::new();
    // Welding is only used for reduction: nothing to weld for exact clusters or for a primitive fitting in a single cluster.
    if strategy == DagStrategy::ExactClusters || dag.len() < 2 {
        return Ok((dag, reductions_kept, tallies, stalls));
    }
    let welds = {
        let _t = Timer::new(Phase::Weld);
        attributes::Welds::of(positions, attributes, indices)
    };
    // Per cluster, the worst normal deviation of the source triangles it descends from: a group's
    // reduction is held to the bound of its own descendants (`quality::deviation_bound`).
    let mut descent = quality::cluster_deviations(&dag, positions, attributes.normals());
    let mut current: Vec<usize> = (0..dag.len()).collect();
    for level in 1..=DAG_MAX_LEVELS {
        checkpoint()?;
        if current.len() < 2 {
            break;
        }
        let lists: Vec<&[u32]> = current
            .iter()
            .map(|&id| dag[id].indices.as_slice())
            .collect();
        let adjacency_by_slot = {
            let _t = Timer::new(Phase::Adjacency);
            cluster_adjacency(&lists)
        };
        let centres: Vec<[f64; 3]> = current
            .iter()
            .map(|&id| {
                let s = dag[id].sphere;
                [s[0], s[1], s[2]]
            })
            .collect();
        let groups = {
            let _t = Timer::new(Phase::Grouping);
            group_clusters(&centres, &adjacency_by_slot, DAG_GROUP_MAX)
        };
        if groups.len() >= current.len() {
            break;
        }
        let locks = {
            let _t = Timer::new(Phase::Locks);
            level_locks(&welds.weld, &lists, &groups)
        };
        let worst: Vec<f64> = groups
            .iter()
            .map(|g| g.iter().map(|&s| descent[current[s]]).fold(0.0, f64::max))
            .collect();
        let reductions: Vec<std::result::Result<GroupReduction, GroupOutcome>> = groups
            .par_iter()
            .zip(&worst)
            .map(
                |(group, &worst)| -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
                    checkpoint()?;
                    let children: Vec<&DagCluster> =
                        group.iter().map(|&slot| &dag[current[slot]]).collect();
                    let bound = quality::deviation_bound(worst);
                    reduce_group(&welds.input(positions, &locks, bound), &children)
                },
            )
            .collect::<Result<Vec<_>>>()?;
        let mut next = Vec::new();
        let mut tally = GroupTally::default();
        for ((group, reduction), &worst) in groups.iter().zip(reductions).zip(&worst) {
            let reduction = match reduction {
                Ok(reduction) => {
                    tally.reduced += 1;
                    tally.relocked += usize::from(reduction.relocked);
                    reduction
                }
                Err(outcome) => {
                    tally.record(outcome.cause);
                    stalls.push(DagStall { level, outcome });
                    continue;
                }
            };
            let first_parent = dag.len();
            let group_index = reductions_kept.len();
            let mut children = Vec::with_capacity(group.len());
            for &slot in group {
                let id = current[slot];
                dag[id].parent_error = reduction.error;
                dag[id].parent_sphere = reduction.sphere;
                dag[id].replacement = Some(first_parent);
                dag[id].group = Some(group_index);
                children.push(id);
            }
            let mut outputs = Vec::with_capacity(reduction.clusters.len());
            for cluster in reduction.clusters {
                outputs.push(dag.len());
                next.push(dag.len());
                descent.push(worst);
                dag.push(DagCluster {
                    indices: cluster,
                    level,
                    lod_error: reduction.error,
                    parent_error: f64::INFINITY,
                    sphere: reduction.sphere,
                    parent_sphere: reduction.sphere,
                    replacement: None,
                    source_rank: reduction.source_rank,
                    group: None,
                    source: Some(group_index),
                });
            }
            reductions_kept.push(DagGroup {
                level,
                error: reduction.error,
                sphere: reduction.sphere,
                children,
                outputs,
            });
        }
        tallies.push(tally);
        if next.is_empty() {
            break;
        }
        let progressed = next.len() < current.len();
        current = next;
        if !progressed {
            break;
        }
    }
    Ok((dag, reductions_kept, tallies, stalls))
}
