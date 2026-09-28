use super::*;

/// What building a primitive's DAG yields.
#[derive(Debug)]
pub struct DagBuild {
    pub clusters: Vec<DagCluster>,
    /// The groups kept.
    pub groups: Vec<DagGroup>,
    /// One per level.
    pub tallies: Vec<GroupTally>,
    /// The stalled groups with their level, in level order.
    pub stalls: Vec<DagStall>,
    /// The vertex arrays grown with every vertex a solved reduction placed; `None` when none did:
    /// the source's then serve.
    pub grown: Option<Grown>,
}

/// Builds cluster DAG. `strategy` decides whether coarse levels exist: in
/// `ExactClusters` build yields level zero alone, without group or reduction, so
/// published coverage is exactly source triangles.
///
/// `attributes` — the normals and every texture set the pages carry — count in the reduction
/// error; a position written under several texture coordinates is a seam no collapse crosses.
///
/// Cluster indices from the source's vertex count on name the vertices a seam-locked group's
/// solve placed (`solved.rs`), in the grown arrays (`DagBuild::grown`).
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
    let mut build = DagBuild {
        clusters: level_zero(positions, indices)?,
        groups: Vec::new(),
        tallies: Vec::new(),
        stalls: Vec::new(),
        grown: None,
    };
    let (dag, stalls) = (&mut build.clusters, &mut build.stalls);
    let (tallies, reductions_kept) = (&mut build.tallies, &mut build.groups);
    // Welding is only used for reduction: nothing to weld for exact clusters or for a primitive fitting in a single cluster.
    if strategy == DagStrategy::ExactClusters || dag.len() < 2 {
        return Ok(build);
    }
    let mut welds = {
        let _t = Timer::new(Phase::Weld);
        welds::Welds::of(positions, attributes, indices)
    };
    // Per cluster, the worst normal deviation of the source triangles it descends from: a group's
    // reduction is held to the bound of its own descendants (`quality::deviation_bound`).
    let mut descent = quality::cluster_deviations(dag, positions, attributes.normals());
    let mut current: Vec<usize> = (0..dag.len()).collect();
    let grown = &mut build.grown;
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
        // The level reads the vertices placed so far, borrowed from `grown` for its reductions
        // alone: placing its own waits for every one of them.
        let (base, reductions) = {
            let (level_positions, carried) = Grown::arrays(grown, positions, attributes);
            let level_attributes = DagAttributes { carried: &carried };
            let weighted = level_attributes.weighted();
            let reduce = |(group, &worst): (&Vec<usize>, &f64)| {
                checkpoint()?;
                let children: Vec<&DagCluster> =
                    group.iter().map(|&slot| &dag[current[slot]]).collect();
                let bound = quality::deviation_bound(worst);
                let input =
                    welds.input(level_positions, level_attributes, &weighted, &locks, bound);
                reduce_group(&input, &children)
            };
            let reductions = groups.par_iter().zip(&worst).map(reduce);
            let reductions = reductions.collect::<Result<Vec<_>>>()?;
            ((level_positions.len() / 3) as u32, reductions)
        };
        let mut next = Vec::new();
        let mut tally = GroupTally::default();
        for ((group, reduction), &worst) in groups.iter().zip(reductions).zip(&worst) {
            let mut reduction = match reduction {
                Ok(reduction) => {
                    tally.reduced += 1;
                    tally.relocked += usize::from(reduction.relocked);
                    tally.solved += usize::from(reduction.placed.is_some());
                    reduction
                }
                Err(outcome) => {
                    tally.record(outcome.cause);
                    stalls.push(DagStall { level, outcome });
                    continue;
                }
            };
            Grown::place(
                grown,
                positions,
                attributes,
                &mut welds,
                &mut reduction,
                base,
            );
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
    Ok(build)
}
