//! The arrays of an assembly's climb (`../assembly.rs`): the mesh's own arrays (`arrays_of`), the
//! roots of the instances laid after them (`lay_instances`), and, once the levels are built, the
//! source vertex every vertex deforms as (`lay_origins`).
use super::Instance;
use crate::dag::*;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::FLAG_COLOR;

/// The mesh's own level 0 (`own`, none when it holds no triangle) and its arrays: the source's, or
/// the build's when it rebuilt them.
pub(super) fn arrays_of(
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
/// instance carries it. An instance carries no other attributes than the primitive it joins: that
/// was decided when it joined (`RootCover::joins`).
pub(super) fn lay_instances(
    instances: &[Instance],
    (positions, carried): (&mut Vec<f32>, &mut Vec<Attribute>),
    clusters: &mut Vec<DagCluster>,
) {
    for instance in instances {
        debug_assert!(
            instance.cover.joins(&layout_of(carried)),
            "an instance joins"
        );
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
        let count = placed.positions.len() / 3;
        for into in carried.iter_mut() {
            let same = |from: &&Attribute| from.flag == into.flag && from.width == into.width;
            match placed.carried.iter().find(same) {
                Some(from) => into.values.extend_from_slice(&from.values),
                None => into
                    .values
                    .resize(into.values.len() + count * into.width, 1.0),
            }
        }
        let base = vertices as u32;
        positions.extend_from_slice(&placed.positions);
        let indices = placed.indices.iter().map(|&v| v + base).collect();
        clusters.push(DagCluster::leaf(
            indices,
            placed.lod_error,
            placed.sphere,
            NO_SOURCE_RANK,
        ));
    }
}

/// The flag and the width of each attribute of `carried`: the layout an instance joins.
fn layout_of(carried: &[Attribute]) -> Vec<(u32, usize)> {
    carried.iter().map(|a| (a.flag, a.width)).collect()
}

/// The arrays of a climbed `build`, which the clusters index: the climb's own when it grew them,
/// else `drawn` and `carried`; with, for each vertex past the mesh's own source, the source vertex
/// it deforms as — the assembly is static, so the roots' (`laid` vertices, after the mesh's own
/// `own_grown`) and those the reductions placed from them take the first. `source_vertices` is the
/// mesh's own source's.
pub(super) fn lay_origins(
    build: &mut DagBuild,
    (drawn, carried): (&[f32], &[Attribute]),
    (own_grown, source_vertices, laid): (Option<Grown>, usize, usize),
) {
    let grown = build.grown.take().unwrap_or(Grown {
        positions: drawn.to_vec(),
        carried: carried.to_vec(),
        origin: Vec::new(),
    });
    let kept = (grown.origin.iter()).map(|&o| if (o as usize) < source_vertices { o } else { 0 });
    let origin: Vec<u32> = (own_grown.into_iter().flat_map(|g| g.origin))
        .chain(std::iter::repeat_n(0, laid))
        .chain(kept)
        .collect();
    build.grown = Some(Grown { origin, ..grown });
}
