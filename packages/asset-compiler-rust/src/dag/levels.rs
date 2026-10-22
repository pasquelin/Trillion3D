//! The coarse levels of a DAG: group, reduce, re-split, until one cluster is left
//! (`build::build_dag`), as many levels as that takes.
//!
//! Each level first grows the box its clusters have reached, over every level so far, which the
//! groups' locality order is laid on; it joins its clusters by their external edges
//! (`clusters::cluster_adjacency`), groups them, reduces every group on the pool, then lays the
//! clusters the reductions made in the order of their identities (`identity.rs`), each with its
//! external edges: that is the next level's order. A level of at most `DAG_GROUP_MAX` clusters is
//! one group: it joins nothing, so its clusters keep the external edges their own groups left them,
//! and the clusters its reduction makes are laid in the order it made them. A group no target size
//! re-splits (`solved.rs`) is kept with its children and no outputs, and its surface is carried no
//! further; but a level whose every group stalls ends the DAG with its clusters as roots (the DAG
//! never ends with none).
use super::*;
use trillion3d_math::geometry::aabb::extend_aabb_f32;

/// A cluster a level's reductions made, before it is laid: its identity, its triangles, its
/// external edges, its group and the group's earliest source triangle.
struct Made {
    identity: u64,
    indices: Vec<u32>,
    outer: Vec<u8>,
    group: usize,
    source_rank: u32,
}

/// Where a climb starts: the clusters `current` the first level above reads, the groups already
/// kept and that level's rank, one past the highest of the levels the clusters lie at.
pub(super) struct Climb {
    pub current: Vec<usize>,
    pub groups: Vec<DagGroup>,
    pub first_level: usize,
}

/// Builds every level above the level-0 clusters `dag`, their `identities` and their external
/// edges `outer` (`clusters.rs`), which index the source's `positions` through its `indices` as
/// the build read them, `welds` their welds and `grown` the source's arrays as the build reads
/// them, none when they are the source's own (`input::finished`); `triangle_source` the source
/// rank of each of those triangles, which `DagBuild` hands on with them.
pub(super) fn coarsen(
    source: (&[f32], DagAttributes, Vec<u32>, Vec<u32>),
    state: (welds::Welds, Option<Grown>),
    level0: (Vec<DagCluster>, Vec<u64>, Vec<Vec<u8>>),
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    let climb = Climb {
        current: (0..level0.0.len()).collect(),
        groups: Vec::new(),
        first_level: 1,
    };
    coarsen_from(source, state, level0, climb, settings, checkpoint)
}

/// `coarsen` over the clusters `climb` names among `dag`, whose `outer` edges are one list each, in
/// its order: the clusters below them are the DAG's already, their `identities` all given. An
/// assembly climbs over the clusters of its own level 0 and the roots of its instances
/// (`assembly.rs`).
pub(super) fn coarsen_from(
    (positions, attributes, indices, triangle_source): (&[f32], DagAttributes, Vec<u32>, Vec<u32>),
    (mut welds, mut grown): (welds::Welds, Option<Grown>),
    (mut dag, mut identities, mut outer): (Vec<DagCluster>, Vec<u64>, Vec<Vec<u8>>),
    climb: Climb,
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    let mut tallies: Vec<GroupTally> = Vec::new();
    let mut stalls: Vec<DagStall> = Vec::new();
    let Climb {
        mut current,
        groups: mut reductions_kept,
        first_level,
    } = climb;
    // The box every level's clusters have reached so far.
    let mut reached = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
    for level in first_level.. {
        checkpoint()?;
        if current.len() < 2 {
            break;
        }
        let lists: Vec<&[u32]> = current
            .iter()
            .map(|&id| dag[id].indices.as_slice())
            .collect();
        // The level reads the vertices placed so far; placing its own waits for every reduction.
        let (level_positions, carried) = Grown::level(&grown, positions, attributes);
        let boxes: Vec<([f32; 3], [f32; 3])> = (lists.par_iter())
            .map(|list| cluster_box(level_positions, list))
            .collect();
        for &(low, high) in &boxes {
            extend_aabb_f32(&mut reached.0, &mut reached.1, low);
            extend_aabb_f32(&mut reached.0, &mut reached.1, high);
        }
        let one_group = current.len() <= DAG_GROUP_MAX;
        let adjacency_by_slot = match one_group {
            true => Vec::new(),
            false => {
                let _t = Timer::new(Phase::Adjacency);
                cluster_adjacency(&lists, &mut outer, welds.weld())
            }
        };
        let sources: Vec<Option<usize>> = current.iter().map(|&id| dag[id].source).collect();
        let groups = {
            let _t = Timer::new(Phase::Grouping);
            group_clusters(&boxes, reached, &sources, &adjacency_by_slot)
        };
        let weighted = DagAttributes { carried: &carried }.weighted();
        let base = (level_positions.len() / 3) as u32;
        let reductions: Vec<GroupReduction> = groups
            .par_iter()
            .map(|group| -> Result<GroupReduction> {
                checkpoint()?;
                let children: Vec<&DagCluster> =
                    group.iter().map(|&slot| &dag[current[slot]]).collect();
                let edges: Vec<&[u8]> = group.iter().map(|&slot| &outer[slot][..]).collect();
                let identity =
                    identity::of_group(group.iter().map(|&slot| identities[current[slot]]));
                let input = welds.input(level_positions, &carried, &weighted, settings.rules);
                reduce_group(&input, &children, &edges, identity)
            })
            .collect::<Result<Vec<_>>>()?;
        let mut tally = GroupTally::default();
        let mut made: Vec<Made> = Vec::new();
        // A level whose every group stalled has no coarser level to make: the next one would have
        // no cluster to group, and a build that went on from there would lose every surface
        // drawn so far. Its clusters stay the DAG's roots, replaced by nothing, so the DAG never
        // ends with none.
        let ends = reductions.iter().all(|reduction| reduction.stall.is_some());
        for (group, reduction) in groups.iter().zip(reductions) {
            let GroupReduction {
                error,
                sphere,
                mut clusters,
                outer: made_outer,
                identities: made_identities,
                source_rank,
                placed,
                stall,
            } = reduction;
            match stall {
                Some(outcome) => {
                    tally.record(outcome.cause);
                    stalls.push(DagStall { level, outcome });
                }
                None => tally.reduced += 1,
            }
            if ends {
                continue;
            }
            let source = (positions, attributes);
            Grown::place(&mut grown, source, &mut welds, placed, &mut clusters, base);
            let group_index = reductions_kept.len();
            let mut children = Vec::with_capacity(group.len());
            for &slot in group {
                let id = current[slot];
                dag[id].parent_error = error;
                dag[id].parent_sphere = sphere;
                dag[id].group = Some(group_index);
                children.push(id);
            }
            let outputs = (made_identities.into_iter().zip(clusters)).zip(made_outer);
            made.extend(outputs.map(|((identity, indices), outer)| Made {
                identity,
                indices,
                outer,
                group: group_index,
                source_rank,
            }));
            reductions_kept.push(DagGroup {
                level,
                error,
                sphere,
                children,
                outputs: Vec::new(),
            });
        }
        if !one_group {
            made.sort_by_key(|made| made.identity);
        }
        let mut next = Vec::with_capacity(made.len());
        outer = Vec::with_capacity(made.len());
        for cluster in made {
            let group = &mut reductions_kept[cluster.group];
            group.outputs.push(dag.len());
            next.push(dag.len());
            identities.push(cluster.identity);
            outer.push(cluster.outer);
            dag.push(DagCluster {
                indices: cluster.indices,
                level,
                lod_error: group.error,
                parent_error: f64::INFINITY,
                sphere: group.sphere,
                whole_box: None,
                parent_sphere: group.sphere,
                source_rank: cluster.source_rank,
                group: None,
                source: Some(cluster.group),
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
        indices,
        triangle_source,
    })
}
