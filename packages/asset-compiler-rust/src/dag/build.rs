use super::*;

/// Construit le DAG des clusters. `strategy` décide si les niveaux grossiers existent : en
/// `ExactClusters` la construction rend le niveau zéro seul, sans groupe ni réduction, si bien que
/// la couverture publiée est exactement celle des triangles de la source.
///
/// `uvs` — deux flottants par sommet, ou rien — dit quelles copies d'une position la réduction a le
/// droit de souder quand elle n'avance plus : celles qui partagent la texture, jamais l'autre bord
/// d'une couture.
pub fn build_dag_tallied(
    positions: &[f32],
    uvs: Option<&[f32]>,
    indices: &[u32],
    strategy: DagStrategy,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<(Vec<DagCluster>, Vec<DagGroup>, Vec<GroupTally>)> {
    checkpoint()?;
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
    let mut reductions_kept: Vec<DagGroup> = Vec::new();
    if strategy == DagStrategy::ExactClusters {
        return Ok((dag, reductions_kept, tallies));
    }
    // Les soudures ne servent qu'à la réduction : après le retour des grappes exactes, pas avant.
    let (weld, weld_seam) = {
        let _t = Timer::new(Phase::Weld);
        (
            weld_positions(positions, indices),
            uvs.map(|uvs| weld_positions_and_uv(positions, uvs, indices)),
        )
    };
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
            level_locks(&weld, &lists, &groups)
        };
        let input = GroupReductionInput {
            positions,
            locks: &locks,
            weld: &weld,
            weld_seam: weld_seam.as_deref().unwrap_or(&weld),
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
            let mut outputs = Vec::with_capacity(reduction.clusters.len());
            for cluster in reduction.clusters {
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
    Ok((dag, reductions_kept, tallies))
}
