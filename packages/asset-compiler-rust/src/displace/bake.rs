//! The displacement baked into a mesh, before its clusters are built: the mesh as the build's input
//! lays it — vertices, each with the attributes the pages carry, and the triangles over them — is
//! tessellated and moved along its normals by its height maps (`tessellate.rs`).
//!
//! The error the tessellation holds the displacement to is `trimmedError`, in percent of the
//! mesh's size (`dag::relative_size`), a half again as much: the build tessellates a half finer
//! than the error it then simplifies back to. The tessellation works in centimetres, where its
//! thresholds are the reference's, so the mesh is brought to them and back.
use super::load::Bake;
use super::mesh::Soup;
use super::policy::Displacer;
use super::tessellate::tessellate;
use crate::simplify::CENTIMETRES;
use trillion3d_page_codec::clusters::named_bounds;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_NORMAL, UV_FLAGS};

/// The mesh once baked: its positions in metres, its attributes — the same kinds, in the same
/// order — and its triangles' corners.
pub(crate) struct Baked {
    pub positions: Vec<f32>,
    pub attributes: Vec<Attribute>,
    pub indices: Vec<u32>,
}

/// How much finer than the error the build is held to the tessellation goes: the mesh is
/// over-tessellated by half and simplified down.
const OVERTESSELLATION: f32 = 1.5;

/// Where in a vertex's row each of `attributes` starts, the row's first three floats the position.
fn offsets(attributes: &[Attribute]) -> Vec<usize> {
    let mut at = 3;
    attributes
        .iter()
        .map(|attribute| {
            let start = at;
            at += attribute.width;
            start
        })
        .collect()
}

/// The vertices the triangles `indices` name, as rows — the position in centimetres, then each
/// attribute — in their order; the position of each alone; and each triangle's corners renumbered
/// to them.
fn rows_of(
    (positions, attributes): (&[f32], &[Attribute]),
    indices: &[u32],
    stride: usize,
) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let vertices = positions.len() / 3;
    let mut used = vec![false; vertices];
    for &vertex in indices {
        used[vertex as usize] = true;
    }
    let mut renumbered = vec![0; vertices];
    let (mut rows, mut centimetres) = (Vec::new(), Vec::new());
    let mut count = 0;
    for vertex in (0..vertices).filter(|&vertex| used[vertex]) {
        renumbered[vertex] = count;
        count += 1;
        let position = positions[vertex * 3..vertex * 3 + 3]
            .iter()
            .map(|x| x * CENTIMETRES);
        centimetres.extend(position.clone());
        rows.extend(position);
        for attribute in attributes {
            let width = attribute.width;
            rows.extend_from_slice(&attribute.values[vertex * width..][..width]);
        }
    }
    debug_assert_eq!(rows.len(), count as usize * stride);
    let corners = indices
        .iter()
        .map(|&vertex| renumbered[vertex as usize])
        .collect();
    (rows, centimetres, corners)
}

/// The mesh `positions` (metres), `attributes` and `indices` as the build's input lays it,
/// tessellated and displaced by the maps of `settings` to the error `trimmed_error`, in percent of the
/// mesh's size. The vertices no triangle names are dropped; the attributes of a vertex the
/// tessellation adds are blended from the corners it lies between, as the position is.
pub(crate) fn bake(
    settings: &Bake,
    trimmed_error: f32,
    (positions, attributes): (&[f32], &[Attribute]),
    indices: &[u32],
) -> Baked {
    let offsets = offsets(attributes);
    let stride = 3 + attributes.iter().map(|a| a.width).sum::<usize>();
    let (rows, centimetres, corners) = rows_of((positions, attributes), indices, stride);
    let area = crate::simplify::region::surface_area(&centimetres, &corners);
    let size = crate::dag::relative_size(area, named_bounds(&centimetres, &corners));
    let target = trimmed_error * 0.01 * size * OVERTESSELLATION;
    let at = |flag: u32| {
        let kind = attributes
            .iter()
            .position(|attribute| attribute.flag == flag);
        kind.map(|kind| offsets[kind])
    };
    let uv_sets = UV_FLAGS.iter().filter_map(|&flag| at(flag)).collect();
    let displacer = Displacer {
        maps: &settings.maps,
        normal: at(FLAG_NORMAL),
        uv: UV_FLAGS.get(settings.uv_channel).and_then(|&flag| at(flag)),
    };
    let triangles = corners.len() / 3;
    let materials = vec![0; triangles];
    let soup = Soup::new(
        (rows, stride),
        uv_sets,
        (corners, materials),
        settings.edge_split,
    );
    let (rows, indices) = tessellate(soup, &displacer, (target * target, target)).into_parts();
    let positions = (rows.chunks_exact(stride))
        .flat_map(|row| row[..3].iter().map(|x| x / CENTIMETRES))
        .collect();
    let attributes = attributes
        .iter()
        .zip(&offsets)
        .map(|(attribute, &at)| Attribute {
            flag: attribute.flag,
            width: attribute.width,
            values: (rows.chunks_exact(stride))
                .flat_map(|row| row[at..at + attribute.width].iter().copied())
                .collect(),
        })
        .collect();
    Baked {
        positions,
        attributes,
        indices,
    }
}
