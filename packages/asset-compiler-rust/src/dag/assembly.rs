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
use trillion3d_page_codec::FLAG_COLOR;

mod cover;
#[cfg(test)]
mod tests;
pub(crate) use cover::{part_space, RootCover};

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

/// The mesh's own level 0 (`own`, none when it holds no triangle) and its arrays: the source's, or
/// the build's when it rebuilt them.
fn arrays_of(
    own: &Option<DagBuild>,
    positions: &[f32],
    attributes: DagAttributes,
) -> (Vec<f32>, Vec<Attribute>) {
    match own {
        Some(built) => {
            let (positions, carried) = Grown::level(&built.grown, positions, attributes);
            (positions.to_vec(), carried.into_iter().cloned().collect())
        }
        None => {
            let empty = |a: &&Attribute| Attribute {
                flag: a.flag,
                width: a.width,
                values: Vec::new(),
            };
            (Vec::new(), attributes.carried.iter().map(empty).collect())
        }
    }
}

/// The instances laid after the mesh's own arrays: each one's cover carried by its matrix
/// (`RootCover::carried_by`), its vertices appended to `positions` and `carried`, and a cluster of
/// its triangles — level 0, its error and ball the root's, in no group — pushed to `clusters`. A
/// colour is the one attribute either side may lack, a build dropping a colour white at every vertex:
/// it is white where it is missing, and a column made of the vertices laid so far when only an
/// instance carries it. Refused when an instance carries other attributes than the primitive.
fn lay_instances(
    instances: &[Instance],
    (positions, carried): (&mut Vec<f32>, &mut Vec<Attribute>),
    clusters: &mut Vec<DagCluster>,
) -> Result<()> {
    let refused = || {
        CompilerError::new(
            "INVALID_ASSEMBLY",
            "An assembly instance carries other attributes than the primitive it joins",
        )
    };
    for instance in instances {
        let placed = instance.cover.carried_by(&instance.matrix);
        let vertices = positions.len() / 3;
        let colour = placed.carried.iter().find(|a| a.flag == FLAG_COLOR);
        if let Some(from) = colour.filter(|_| !carried.iter().any(|a| a.flag == FLAG_COLOR)) {
            carried.push(Attribute {
                flag: from.flag,
                width: from.width,
                values: vec![1.0; vertices * from.width],
            });
        }
        let has =
            |into: &Attribute, from: &Attribute| into.flag == from.flag && into.width == from.width;
        let known = placed
            .carried
            .iter()
            .all(|from| carried.iter().any(|into| has(into, from)));
        if !known {
            return Err(refused());
        }
        let count = placed.positions.len() / 3;
        for into in carried.iter_mut() {
            match placed.carried.iter().find(|from| has(into, from)) {
                Some(from) => into.values.extend_from_slice(&from.values),
                None if into.flag == FLAG_COLOR => into
                    .values
                    .resize(into.values.len() + count * into.width, 1.0),
                None => return Err(refused()),
            }
        }
        let base = vertices as u32;
        positions.extend_from_slice(&placed.positions);
        let indices = placed.indices.iter().map(|&v| v + base).collect();
        clusters.push(DagCluster::leaf(
            indices,
            placed.lod_error,
            placed.sphere,
            u32::MAX,
        ));
    }
    Ok(())
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

/// The DAG of the primitive `positions`, `attributes` and `indices` describe — the assembly's own
/// triangles, none for a mesh that has none — with the levels above its own clusters and the roots
/// of `instances`. Each instance's group is `Climbed::parents`'s entry for it. A build with no
/// cluster of its own and fewer than two instances, or none above level 0, has nothing to climb:
/// refused when it holds no cluster, else returned as `build_dag` returns it.
pub(crate) fn build_with_instances(
    (positions, attributes, indices): (&[f32], DagAttributes, &[u32]),
    instances: &[Instance],
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<Climbed> {
    let exact = DagSettings {
        strategy: DagStrategy::ExactClusters,
        ..settings
    };
    let own = match indices.is_empty() {
        true => None,
        false => match build_levels(positions, attributes, indices, exact, checkpoint) {
            Ok(built) => Some(built),
            Err(refusal) if refusal.code == "INVALID_TRIANGLES" => None,
            Err(refusal) => return Err(refusal),
        },
    };
    let (mut drawn, mut carried) = arrays_of(&own, positions, attributes);
    let DagBuild {
        clusters: mut dag,
        indices: source_indices,
        triangle_source,
        grown: own_grown,
        ..
    } = own.unwrap_or_else(|| DagBuild {
        clusters: Vec::new(),
        groups: Vec::new(),
        tallies: Vec::new(),
        stalls: Vec::new(),
        grown: None,
        indices: Vec::new(),
        triangle_source: Vec::new(),
    });
    let own_clusters = dag.len();
    if dag.is_empty() && (settings.strategy == DagStrategy::ExactClusters || instances.len() < 2) {
        return Err(CompilerError::new(
            "INVALID_TRIANGLES",
            "Every triangle has two corners at one point",
        ));
    }
    if settings.strategy == DagStrategy::ExactClusters || dag.len() + instances.len() < 2 {
        let mut build = DagBuild {
            clusters: dag,
            groups: Vec::new(),
            tallies: Vec::new(),
            stalls: Vec::new(),
            grown: own_grown,
            indices: source_indices,
            triangle_source,
        };
        finish(&mut build, positions);
        let parents = vec![None; instances.len()];
        return Ok(Climbed { build, parents });
    }
    lay_instances(instances, (&mut drawn, &mut carried), &mut dag)?;
    let refs: Vec<&Attribute> = carried.iter().collect();
    let all = DagAttributes { carried: &refs };
    let used: Vec<u32> = dag.iter().flat_map(|c| c.indices.iter().copied()).collect();
    let welds = welds::Welds::of(&drawn, all, &used);
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
    // The vertices past the mesh's own source, each with the source vertex it deforms as: the
    // assembly is static, so the roots' and those the reductions placed from them take the first.
    let grown = build.grown.take().unwrap_or(Grown {
        positions: drawn.clone(),
        carried: carried.clone(),
        origin: Vec::new(),
    });
    let laid: usize = instances.iter().map(|i| i.cover.positions.len() / 3).sum();
    let kept = (grown.origin.iter()).map(|&o| {
        if (o as usize) < positions.len() / 3 {
            o
        } else {
            0
        }
    });
    let origin: Vec<u32> = (own_grown.into_iter().flat_map(|g| g.origin))
        .chain(std::iter::repeat_n(0, laid))
        .chain(kept)
        .collect();
    build.grown = Some(Grown { origin, ..grown });
    finish(&mut build, &drawn);
    Ok(Climbed { build, parents })
}
