//! The coarse levels of a DAG: group, reduce, re-split, until the level stops shrinking. Shared by
//! a primitive's build and by the world super-roots entered from existing root clusters.
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
            level_locks(welds.weld(), &lists, &groups)
        };
        let worst: Vec<f64> = groups
            .iter()
            .map(|g| g.iter().map(|&s| descent[current[s]]).fold(0.0, f64::max))
            .collect();
        // The level reads the vertices placed so far; placing its own waits for every reduction.
        let (level_positions, carried) = Grown::arrays(&grown, positions, attributes);
        let weighted = DagAttributes { carried: &carried }.weighted();
        let base = (level_positions.len() / 3) as u32;
        let reductions: Vec<std::result::Result<GroupReduction, GroupOutcome>> = groups
            .par_iter()
            .zip(&worst)
            .map(
                |(group, &worst)| -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
                    checkpoint()?;
                    let children: Vec<&DagCluster> =
                        group.iter().map(|&slot| &dag[current[slot]]).collect();
                    let bound = quality::deviation_bound(worst);
                    let input = welds.input(level_positions, &carried, &weighted, &locks, bound);
                    reduce_group(&input, &children)
                },
            )
            .collect::<Result<Vec<_>>>()?;
        let mut next = Vec::new();
        let mut tally = GroupTally::default();
        for ((group, reduction), &worst) in groups.iter().zip(reductions).zip(&worst) {
            let mut reduction = match reduction {
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
            Grown::place(&mut grown, &mut welds, &mut reduction, base);
            let group_index = reductions_kept.len();
            let mut children = Vec::with_capacity(group.len());
            for &slot in group {
                let id = current[slot];
                dag[id].parent_error = reduction.error;
                dag[id].parent_sphere = reduction.sphere;
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
    Ok((dag, reductions_kept, tallies, stalls, grown))
}
