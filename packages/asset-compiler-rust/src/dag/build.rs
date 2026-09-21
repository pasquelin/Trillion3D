use super::*;

/// Level zero: the exact spatial partition of the source triangles, one cluster per entry.
fn level_zero(positions: &[f32], indices: &[u32]) -> Result<Vec<DagCluster>> {
    // Rank of the source triangle each vertex first appears in, used to keep the draw order stable.
    let mut first_use = vec![u32::MAX; positions.len() / 3];
    for (offset, &vertex) in indices.iter().enumerate() {
        let slot = vertex as usize;
        if slot < first_use.len() && first_use[slot] == u32::MAX {
            first_use[slot] = (offset / 3) as u32;
        }
    }
    let level0 = {
        let _t = Timer::new(Phase::ClusterLevel0);
        cluster_triangles(positions, indices, DAG_CLUSTER_TRIANGLES)?
    };
    Ok(level0
        .into_iter()
        .map(|cluster| {
            let sphere = bounding_sphere(positions, &cluster);
            let source_rank = cluster
                .iter()
                .map(|&v| first_use.get(v as usize).copied().unwrap_or(u32::MAX))
                .min()
                .unwrap_or(0);
            DagCluster {
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
            }
        })
        .collect())
}

/// Builds the cluster DAG over `vertices`, which `QemAttributes` extends with the vertices its
/// coarse levels create. `strategy` decides whether coarse levels exist: in `ExactClusters` the
/// build yields level zero alone, without group or reduction, so the published coverage is
/// exactly the source triangles.
pub fn build_dag_tallied(
    mut vertices: DagVertices<'_>,
    indices: &[u32],
    strategy: DagStrategy,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    checkpoint()?;
    let source_vertices = vertices.count();
    let mut dag = level_zero(vertices.positions, indices)?;
    let mut tallies: Vec<GroupTally> = Vec::new();
    let mut reductions_kept: Vec<DagGroup> = Vec::new();
    let build = |dag, groups, tallies, vertices: &DagVertices<'_>| DagBuild {
        clusters: dag,
        groups,
        tallies,
        added_vertices: vertices.count() - source_vertices,
    };
    // Welding is only used for reduction: nothing to weld for exact clusters or for a primitive fitting in a single cluster.
    if strategy == DagStrategy::ExactClusters || dag.len() < 2 {
        return Ok(build(dag, reductions_kept, tallies, &vertices));
    }
    let mut welds = {
        let _t = Timer::new(Phase::Weld);
        Welds::of(&vertices, indices)
    };
    // Texture seams of the source; a created vertex inherits the flag of the vertex it was
    // solved from (`reduce_attributes.rs`), so the table follows the buffer.
    let mut protect = welds.texture_seams();
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
            level_locks(&welds.position, &lists, &groups)
        };
        let input = GroupReductionInput {
            strategy,
            positions: vertices.positions,
            attributes: vertices.attributes,
            locks: &locks,
            protect: &protect,
            weld: &welds.position,
            weld_seam: welds.seam.as_deref().unwrap_or(&welds.position),
        };
        let reductions: Vec<std::result::Result<GroupReduction, GroupOutcome>> = groups
            .par_iter()
            .map(
                |group| -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
                    checkpoint()?;
                    let children: Vec<&DagCluster> =
                        group.iter().map(|&slot| &dag[current[slot]]).collect();
                    reduce_group(&input, &children)
                },
            )
            .collect::<Result<Vec<_>>>()?;
        let mut next = Vec::new();
        let mut tally = GroupTally::default();
        for (group, reduction) in groups.iter().zip(reductions) {
            let reduction = match reduction {
                Ok(reduction) => {
                    tally.record(GroupOutcome::Reduced);
                    tally.welded += usize::from(reduction.welded);
                    tally.relocked += usize::from(reduction.relocked);
                    reduction
                }
                Err(outcome) => {
                    tally.record(outcome);
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
            // The vertices this group created take their place in the buffer, in group order:
            // the same mesh always yields the same buffer.
            let first_new = attributes::append(&mut vertices, &reduction.vertices);
            protect.extend_from_slice(&reduction.vertices.protected);
            let mut outputs = Vec::with_capacity(reduction.clusters.len());
            for mut cluster in reduction.clusters {
                for corner in cluster.iter_mut() {
                    if *corner & NEW_VERTEX != 0 {
                        *corner = first_new + (*corner & !NEW_VERTEX);
                    }
                }
                outputs.push(dag.len());
                next.push(dag.len());
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
        welds.extend(&vertices);
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
    Ok(build(dag, reductions_kept, tallies, &vertices))
}
