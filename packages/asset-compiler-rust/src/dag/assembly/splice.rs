//! The blocks of an assembly built apart and laid into one DAG (`assembly.rs`): each block's DAG
//! before the encoder's steps, then every block's arrays, clusters and groups after one another.
use super::*;
use crate::dag::build::build_levels;

/// A block built alone: its DAG before the encoder's steps, the arrays that DAG reads, and the
/// rank of the block's first triangle among the primitive's.
pub(super) struct Built {
    dag: DagBuild,
    positions: Vec<f32>,
    carried: Vec<Attribute>,
    first_triangle: u32,
    own: bool,
}

/// Block `block` of the arrays as a DAG of its own: the mesh's own block (`exact`) as its level-0
/// clusters alone, the others as `settings` say. A block whose triangles all have two corners at
/// one point builds none.
pub(super) fn build_block(
    (positions, attributes, indices): (&[f32], DagAttributes, &[u32]),
    (block, exact): (&Block, bool),
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<Option<Built>> {
    let ((v0, vn), (i0, i_n)) = (block.vertices, block.indices);
    let slice: Vec<f32> = positions[v0 * 3..(v0 + vn) * 3].to_vec();
    let carried: Vec<Attribute> = (attributes.carried.iter())
        .map(|a| Attribute {
            flag: a.flag,
            width: a.width,
            values: a.values[v0 * a.width..(v0 + vn) * a.width].to_vec(),
        })
        .collect();
    let refs: Vec<&Attribute> = carried.iter().collect();
    let local: Vec<u32> = indices[i0..i0 + i_n]
        .iter()
        .map(|&v| v - v0 as u32)
        .collect();
    let strategy = if exact {
        DagStrategy::ExactClusters
    } else {
        settings.strategy
    };
    let settings = DagSettings {
        strategy,
        ..settings
    };
    let attributes = DagAttributes { carried: &refs };
    let dag = match build_levels(&slice, attributes, &local, settings, checkpoint) {
        Ok(dag) => dag,
        Err(refusal) if refusal.code == "INVALID_TRIANGLES" => return Ok(None),
        Err(refusal) => return Err(refusal),
    };
    drop(refs);
    let (positions, carried) = match dag.grown {
        Some(_) => (Vec::new(), Vec::new()),
        None => (slice, carried),
    };
    Ok(Some(Built {
        dag,
        positions,
        carried,
        first_triangle: (i0 / 3) as u32,
        own: exact,
    }))
}

/// Every block's DAG laid into one: the arrays after one another, the clusters and groups with
/// their links renumbered past those before, the source triangles as the builds read them.
#[derive(Default)]
pub(super) struct Splice {
    /// The clusters of the mesh's own block, whose edges meet each other's.
    pub(super) own: std::ops::Range<usize>,
    pub(super) positions: Vec<f32>,
    pub(super) carried: Vec<Attribute>,
    pub(super) clusters: Vec<DagCluster>,
    pub(super) groups: Vec<DagGroup>,
    pub(super) indices: Vec<u32>,
    pub(super) triangle_source: Vec<u32>,
    pub(super) tallies: Vec<GroupTally>,
    pub(super) stalls: Vec<DagStall>,
}

/// The attributes of `flat`, in its order, as the blocks' arrays lay them end to end: those a
/// block dropped (a colour white at every vertex) read white there.
fn joined(flat: &[&Attribute], blocks: &[(Vec<f32>, Vec<Attribute>)]) -> Vec<Attribute> {
    let mut joined = Vec::new();
    for attribute in flat {
        let of = |(_, carried): &(Vec<f32>, Vec<Attribute>)| {
            carried
                .iter()
                .find(|a| a.flag == attribute.flag)
                .map(|a| a.values.len())
        };
        if !blocks.iter().any(|block| of(block).is_some()) {
            continue;
        }
        let mut values = Vec::new();
        for block in blocks {
            match block.1.iter().find(|a| a.flag == attribute.flag) {
                Some(found) => values.extend_from_slice(&found.values),
                None => values.resize(values.len() + block.0.len() / 3 * attribute.width, 1.0),
            }
        }
        joined.push(Attribute {
            flag: attribute.flag,
            width: attribute.width,
            values,
        });
    }
    joined
}

/// Adds `block`'s tallies, level by level, to `total`.
fn add_tallies(total: &mut Vec<GroupTally>, block: &[GroupTally]) {
    for (level, tally) in block.iter().enumerate() {
        if total.len() <= level {
            total.push(GroupTally::default());
        }
        total[level].reduced += tally.reduced;
        for (sum, stalled) in total[level].stalled.iter_mut().zip(&tally.stalled) {
            *sum += stalled;
        }
    }
}

impl Splice {
    pub(super) fn of(built: Vec<Built>, flat: &[&Attribute]) -> Self {
        let mut spliced = Self::default();
        let mut blocks = Vec::with_capacity(built.len());
        let mut kept = 0u32;
        for Built {
            dag,
            positions,
            carried,
            first_triangle,
            own,
        } in built
        {
            let DagBuild {
                clusters,
                groups,
                tallies,
                stalls,
                grown,
                indices,
                triangle_source,
            } = dag;
            let base = blocks_len(&blocks) as u32;
            let (positions, carried) = match grown {
                Some(grown) => (grown.positions, grown.carried),
                None => (positions, carried),
            };
            let first = spliced.clusters.len();
            append_dag(
                (&mut spliced.clusters, &mut spliced.groups),
                (clusters, groups),
                base,
            );
            if own {
                spliced.own = first..spliced.clusters.len();
            }
            // A cluster's source rank is its first triangle's among those the builds kept.
            for cluster in &mut spliced.clusters[first..] {
                cluster.source_rank = cluster.source_rank.saturating_add(kept);
            }
            kept += (indices.len() / 3) as u32;
            spliced.indices.extend(indices.iter().map(|v| v + base));
            spliced
                .triangle_source
                .extend(triangle_source.iter().map(|r| r + first_triangle));
            add_tallies(&mut spliced.tallies, &tallies);
            spliced.stalls.extend(stalls);
            blocks.push((positions, carried));
        }
        spliced.carried = joined(flat, &blocks);
        spliced.positions = blocks
            .into_iter()
            .flat_map(|(positions, _)| positions)
            .collect();
        spliced
    }
}

/// The vertices the blocks laid so far hold.
fn blocks_len(blocks: &[(Vec<f32>, Vec<Attribute>)]) -> usize {
    blocks
        .iter()
        .map(|(positions, _)| positions.len() / 3)
        .sum()
}
