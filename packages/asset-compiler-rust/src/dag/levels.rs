//! The coarse levels of a DAG: group, reduce, re-split, until one cluster is left
//! (`build::build_dag`), at most `DAG_MAX_LEVELS` levels.
use super::*;

/// Builds every level above `dag`, whose clusters index `positions` through `indices`.
pub(super) fn coarsen(
    positions: &[f32],
    attributes: DagAttributes,
    indices: &[u32],
    mut dag: Vec<DagCluster>,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    let mut tallies: Vec<GroupTally> = Vec::new();
    let mut stalls: Vec<DagStall> = Vec::new();
    let mut reductions_kept: Vec<DagGroup> = Vec::new();
    let mut welds = {
        let _t = Timer::new(Phase::Weld);
        welds::Welds::of(positions, attributes, indices)
    };
    let mut grown = None;
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
            cluster_adjacency(&lists, welds.weld())
        };
        // The level reads the vertices placed so far; placing its own waits for every reduction.
        let (level_positions, carried) = Grown::arrays(&grown, positions, attributes);
        let sources: Vec<Option<usize>> = current.iter().map(|&id| dag[id].source).collect();
        let groups = {
            let _t = Timer::new(Phase::Grouping);
            let bounds = vertex_bounds(positions);
            group_clusters(
                &lists,
                level_positions,
                bounds,
                &sources,
                &adjacency_by_slot,
            )
        };
        let locks = {
            let _t = Timer::new(Phase::Locks);
            level_locks(welds.weld(), &lists, &groups)
        };
        let weighted = DagAttributes { carried: &carried }.weighted();
        let base = (level_positions.len() / 3) as u32;
        let reductions: Vec<std::result::Result<GroupReduction, GroupOutcome>> = groups
            .par_iter()
            .map(
                |group| -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
                    checkpoint()?;
                    let children: Vec<&DagCluster> =
                        group.iter().map(|&slot| &dag[current[slot]]).collect();
                    let input = welds.input(level_positions, &carried, &weighted, &locks);
                    reduce_group(&input, &children)
                },
            )
            .collect::<Result<Vec<_>>>()?;
        let mut next = Vec::new();
        let mut tally = GroupTally::default();
        for (group, reduction) in groups.iter().zip(reductions) {
            let reduction = match reduction {
                Ok(reduction) => {
                    tally.reduced += 1;
                    reduction
                }
                Err(outcome) => {
                    tally.record(outcome.cause);
                    stalls.push(DagStall { level, outcome });
                    continue;
                }
            };
            let GroupReduction {
                error,
                sphere,
                mut clusters,
                source_rank,
                placed,
            } = reduction;
            Grown::place(&mut grown, &mut welds, placed, &mut clusters, base);
            let group_index = reductions_kept.len();
            let mut children = Vec::with_capacity(group.len());
            for &slot in group {
                let id = current[slot];
                dag[id].parent_error = error;
                dag[id].parent_sphere = sphere;
                dag[id].group = Some(group_index);
                children.push(id);
            }
            let mut outputs = Vec::with_capacity(clusters.len());
            for cluster in clusters {
                outputs.push(dag.len());
                next.push(dag.len());
                dag.push(DagCluster {
                    indices: cluster,
                    level,
                    lod_error: error,
                    parent_error: f64::INFINITY,
                    sphere,
                    parent_sphere: sphere,
                    source_rank,
                    group: None,
                    source: Some(group_index),
                });
            }
            reductions_kept.push(DagGroup {
                level,
                error,
                sphere,
                children,
                outputs,
            });
        }
        tallies.push(tally);
        if next.is_empty() {
            break;
        }
        current = next;
    }
    Ok(DagBuild {
        clusters: dag,
        groups: reductions_kept,
        tallies,
        stalls,
        grown,
    })
}
