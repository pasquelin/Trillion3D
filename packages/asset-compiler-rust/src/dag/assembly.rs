//! The levels above an assembly's instances (`compiler/source/assembly.rs`), built as the
//! reference builds them: the mesh's own clusters enter the reduction at level 0 beside the root of
//! every instance — the one cluster its part's DAG ends in (`RootCover`), placed by the instance's
//! transform, its error and ball taken through it —, and the levels above are built over them as
//! over any DAG's level 0 (`levels.rs`, `coarsen_from`): the same groups and reductions, over
//! clusters of any origin. A root becomes a child of the group above it, whose error and ball are
//! the parent error and the LOD ball its instance carries (`Parent`); the root's own pages are its
//! part's, written once, never copied.
//!
//! The DAG that comes back holds the mesh's own clusters and the clusters the levels made: an
//! instance's root is no cluster of it, and a group whose children were instances alone lists
//! none. Its arrays are the mesh's own, then the roots' vertices placed, then those the reductions
//! placed.
use super::build::{build_levels, finish};
use super::levels::{coarsen_from, Climb};
use super::*;
use crate::compiler::source::node_transform::Mat4;
use std::ops::Range;
use trillion3d_page_codec::encode::Attribute;

mod cover;
mod lay;
#[cfg(test)]
mod tests;
pub(crate) use cover::{part_space, RootCover};
use lay::{arrays_of, lay_instances, lay_origins};

/// An instance of the assembly: the root of the part it draws and the transform it stands at, in
/// the assembly's space.
pub(crate) struct Instance<'a> {
    pub cover: &'a RootCover,
    pub matrix: Mat4,
}

/// The error and ball of the group that replaces an instance's root, in the assembly's space.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Parent {
    pub error: f64,
    pub sphere: [f64; 4],
}

/// The DAG of an assembly's primitive and, for each instance in order, the group that replaces its
/// root — none when nothing does: the instance is alone, or its group stalled into the DAG's roots.
pub(crate) struct Climbed {
    pub build: DagBuild,
    pub parents: Vec<Option<Parent>>,
}

/// The external edges of the clusters the climb starts over: those of the mesh's own — the first
/// `own` — meet each other's, every corner of them a candidate, the ones another cluster's edge
/// meets counted; an instance's root has none, as the reference's roots hold no external edge.
fn seed_edges(clusters: &[DagCluster], own: usize, welds: &welds::Welds) -> Vec<Vec<u8>> {
    let mut outer: Vec<Vec<u8>> = (clusters.iter().enumerate())
        .map(|(id, cluster)| vec![u8::from(id < own); cluster.indices.len()])
        .collect();
    if own > 0 {
        let lists: Vec<&[u32]> = clusters[..own].iter().map(|c| &c.indices[..]).collect();
        cluster_adjacency(&lists, &mut outer[..own], welds.weld());
    }
    outer
}

/// `build` without the clusters `gone`, the instances' roots: the others renumbered in their order,
/// each group's children and outputs with them.
fn without(build: &mut DagBuild, gone: Range<usize>) {
    let count = gone.len();
    let renumbered = |id: usize| match id {
        id if id < gone.start => Some(id),
        id if id >= gone.end => Some(id - count),
        _ => None,
    };
    build.clusters.drain(gone.clone());
    for group in &mut build.groups {
        group.children = group
            .children
            .iter()
            .filter_map(|&c| renumbered(c))
            .collect();
        group.outputs = group
            .outputs
            .iter()
            .filter_map(|&c| renumbered(c))
            .collect();
    }
}

/// The mesh's own level 0: the clusters its triangles make as `build_levels` makes them — none for
/// a mesh with no triangle, or none that is not two corners at one point.
fn own_level0(
    (positions, attributes, indices): (&[f32], DagAttributes, &[u32]),
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<Option<DagBuild>> {
    let exact = DagSettings {
        strategy: DagStrategy::ExactClusters,
        ..settings
    };
    if indices.is_empty() {
        return Ok(None);
    }
    match build_levels(positions, attributes, indices, exact, checkpoint) {
        Ok(built) => Ok(Some(built)),
        Err(refusal) if refusal.code == "INVALID_TRIANGLES" => Ok(None),
        Err(refusal) => Err(refusal),
    }
}

/// A DAG of no cluster: the level 0 of a mesh with no triangle.
fn nothing() -> DagBuild {
    DagBuild {
        clusters: Vec::new(),
        groups: Vec::new(),
        tallies: Vec::new(),
        stalls: Vec::new(),
        grown: None,
        indices: Vec::new(),
        triangle_source: Vec::new(),
    }
}

/// The climb over the mesh's own clusters (`own`, whose arrays are the first of `drawn` and
/// `carried`) and the roots of `instances`, laid after them: the levels above them all, and the
/// group that replaces each instance's root, which is not a cluster of the DAG that comes back.
fn climb(
    own: DagBuild,
    (drawn, carried): (&mut Vec<f32>, &mut Vec<Attribute>),
    instances: &[Instance],
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<Climbed> {
    let DagBuild {
        clusters: mut dag,
        indices: source_indices,
        triangle_source,
        ..
    } = own;
    let own_clusters = dag.len();
    lay_instances(instances, (&mut *drawn, &mut *carried), &mut dag);
    let refs: Vec<&Attribute> = carried.iter().collect();
    let all = DagAttributes { carried: &refs };
    let used: Vec<u32> = dag.iter().flat_map(|c| c.indices.iter().copied()).collect();
    let welds = welds::Welds::of(drawn, all, &used);
    let identities: Vec<u64> = (0..dag.len())
        .map(|id| identity::of_range(id, id + 1))
        .collect();
    let outer = seed_edges(&dag, own_clusters, &welds);
    let climb = Climb {
        current: (0..dag.len()).collect(),
        groups: Vec::new(),
        first_level: 1,
    };
    let source = (&drawn[..], all, source_indices, triangle_source);
    let level0 = (dag, identities, outer);
    let mut build = coarsen_from(source, (welds, None), level0, climb, settings, checkpoint)?;
    let roots = own_clusters..own_clusters + instances.len();
    let parents: Vec<Option<Parent>> = (build.clusters[roots.clone()].iter())
        .map(|root| {
            root.parent_error.is_finite().then_some(Parent {
                error: root.parent_error,
                sphere: root.parent_sphere,
            })
        })
        .collect();
    without(&mut build, roots);
    Ok(Climbed { build, parents })
}

/// The DAG of the primitive `positions`, `attributes` and `indices` describe — the assembly's own
/// triangles, none for a mesh that has none — with the levels above its own clusters and the roots
/// of `instances`. Each instance's group is `Climbed::parents`'s entry for it. A build with no
/// cluster of its own and fewer than two instances, or none above level 0, has nothing to climb:
/// refused when it holds no cluster, else returned as `build_dag` returns it.
pub(crate) fn build_with_instances(
    arrays: (&[f32], DagAttributes, &[u32]),
    instances: &[Instance],
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<Climbed> {
    let (positions, attributes, _) = arrays;
    let own = own_level0(arrays, settings, checkpoint)?;
    let (mut drawn, mut carried) = arrays_of(&own, positions, attributes);
    let mut own = own.unwrap_or_else(nothing);
    let exact = settings.strategy == DagStrategy::ExactClusters;
    if own.clusters.is_empty() && (exact || instances.len() < 2) {
        return Err(CompilerError::new(
            "INVALID_TRIANGLES",
            "Every triangle has two corners at one point",
        ));
    }
    if exact || own.clusters.len() + instances.len() < 2 {
        let mut build = DagBuild {
            groups: Vec::new(),
            tallies: Vec::new(),
            stalls: Vec::new(),
            ..own
        };
        finish(&mut build, positions);
        let parents = vec![None; instances.len()];
        return Ok(Climbed { build, parents });
    }
    let own_grown = own.grown.take();
    let climbed = climb(
        own,
        (&mut drawn, &mut carried),
        instances,
        settings,
        checkpoint,
    )?;
    let Climbed { mut build, parents } = climbed;
    let laid: usize = instances.iter().map(|i| i.cover.positions.len() / 3).sum();
    let counts = (own_grown, positions.len() / 3, laid);
    lay_origins(&mut build, (&drawn, &carried), counts);
    finish(&mut build, &drawn);
    Ok(Climbed { build, parents })
}
