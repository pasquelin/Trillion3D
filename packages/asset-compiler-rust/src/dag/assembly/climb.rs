//! The levels above the roots of an assembly's blocks (`assembly.rs`): built over them as over a
//! DAG's level 0, each root's external edges as the reference's roots hold them.
use super::splice::Splice;
use super::*;
use crate::dag::levels::{coarsen_from, Climb};

/// The clusters of `spliced`, none of them climbed: what a build that makes no coarse level
/// holds, every block's clusters as level 0.
pub(super) fn unclimbed(spliced: &mut Splice) -> DagBuild {
    DagBuild {
        clusters: std::mem::take(&mut spliced.clusters),
        groups: std::mem::take(&mut spliced.groups),
        tallies: Vec::new(),
        stalls: Vec::new(),
        grown: None,
        indices: std::mem::take(&mut spliced.indices),
        triangle_source: std::mem::take(&mut spliced.triangle_source),
    }
}

/// The external edges of the roots `seeds` of `spliced`: those of the mesh's own block meet each
/// other's — every corner of them a candidate, the ones another cluster's edge meets counted —,
/// an instance's root has none, as the reference's roots hold no external edge.
fn seed_edges(spliced: &Splice, seeds: &[usize], welds: &welds::Welds) -> Vec<Vec<u8>> {
    let mut outer: Vec<Vec<u8>> = (seeds.iter())
        .map(|&id| {
            let candidate = u8::from(spliced.own.contains(&id));
            vec![candidate; spliced.clusters[id].indices.len()]
        })
        .collect();
    if !spliced.own.is_empty() {
        let lists: Vec<&[u32]> = (seeds.iter())
            .map(|&id| spliced.clusters[id].indices.as_slice())
            .collect();
        cluster_adjacency(&lists, &mut outer, welds.weld());
    }
    outer
}

/// The levels above the roots of every block of `spliced`, built over them as over a DAG's level 0.
pub(super) fn climb(
    spliced: &mut Splice,
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    let refs: Vec<&Attribute> = spliced.carried.iter().collect();
    let attributes = DagAttributes { carried: &refs };
    let used: Vec<u32> = (spliced.clusters.iter())
        .flat_map(|cluster| cluster.indices.iter().copied())
        .collect();
    let welds = welds::Welds::of(&spliced.positions, attributes, &used);
    let identities: Vec<u64> = (0..spliced.clusters.len())
        .map(|id| identity::of_range(id, id + 1))
        .collect();
    let seeds: Vec<usize> = (spliced.clusters.iter().enumerate())
        .filter(|(_, cluster)| cluster.is_root())
        .map(|(id, _)| id)
        .collect();
    let outer = seed_edges(spliced, &seeds, &welds);
    // One level above the highest a root lies at.
    let first_level = (seeds.iter())
        .map(|&id| spliced.clusters[id].level + 1)
        .max()
        .unwrap_or(1);
    let source = (
        &spliced.positions[..],
        attributes,
        std::mem::take(&mut spliced.indices),
        std::mem::take(&mut spliced.triangle_source),
    );
    let level0 = (std::mem::take(&mut spliced.clusters), identities, outer);
    let groups = std::mem::take(&mut spliced.groups);
    let climb = Climb {
        current: seeds,
        groups,
        first_level,
    };
    coarsen_from(source, (welds, None), level0, climb, settings, checkpoint)
}
