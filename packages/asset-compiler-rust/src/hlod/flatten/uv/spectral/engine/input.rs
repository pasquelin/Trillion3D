//! The partition's input checked as the library checks it, before any chart is built.
//!
//! - There must be vertices and faces, fewer than `u32::MAX` vertices and `3 × faces` under
//!   `u32::MAX`; every table holds 3 entries per face (the signal 3 floats per face) and every
//!   index names a vertex (the library reads past the buffers instead).
//! - The chart bound is lowered to the face count.
//! - False edges: none may lie on an edge without a face across it; the two corners of each false
//!   edge must be joined through true edges, the corners shared across adjacent faces counting as
//!   one.
//! - The stretch bound (checked once the charts are built, as the library does) lies in `[0, 1]`.
use super::Request;
use crate::hlod::flatten::uv::spectral::fail::{invalid_argument, invalid_data};
use crate::hlod::flatten::uv::spectral::mesh::NONE;
use trillion3d_math::join::{Join, LeastRoot};

/// The request checked; the chart bound to use.
pub(super) fn check(request: &Request) -> crate::Result<usize> {
    let faces = request.indices.len() / 3;
    let vertex_count = request.points.len();
    if vertex_count == 0 || faces == 0 || request.indices.len() != 3 * faces {
        return Err(invalid_argument("no vertex or no face"));
    }
    if vertex_count as u64 >= u32::MAX as u64 || 3 * faces as u64 >= u32::MAX as u64 {
        return Err(invalid_argument("too many vertices or faces"));
    }
    if request.adjacency.len() != 3 * faces
        || request.false_edges.is_some_and(|f| f.len() != 3 * faces)
        || request.signal.is_some_and(|s| s.len() != 3 * faces)
    {
        return Err(invalid_argument("a table does not hold 3 entries per face"));
    }
    if request.indices.iter().any(|&i| i as usize >= vertex_count) {
        return Err(invalid_argument("an index names no vertex"));
    }
    if let Some(false_edges) = request.false_edges {
        let on_open_edge =
            (request.adjacency.iter().zip(false_edges)).any(|(&a, &f)| a == NONE && f != NONE);
        if on_open_edge {
            return Err(invalid_data("a false edge has no face across it"));
        }
        false_edges_joined(request.adjacency, false_edges, faces)?;
    }
    Ok(request.max_charts.min(faces))
}

/// Whether the corners of every false edge are joined through true edges.
fn false_edges_joined(adjacency: &[u32], false_edges: &[u32], faces: usize) -> crate::Result<()> {
    let mut corners = Join::<LeastRoot>::new(3 * faces);
    for i in 0..faces {
        for j in 0..3 {
            let neighbour = adjacency[3 * i + j] as usize;
            if neighbour >= faces {
                continue;
            }
            let Some(k) = (0..3).find(|&k| adjacency[3 * neighbour + k] as usize == i) else {
                return Err(invalid_data("the adjacency is not mutual"));
            };
            corners.unite((3 * i + j) as u32, (3 * neighbour + (k + 1) % 3) as u32);
        }
    }
    for i in 0..faces {
        for j in 0..3 {
            if false_edges[3 * i + j] == NONE {
                corners.unite((3 * i + j) as u32, (3 * i + (j + 1) % 3) as u32);
            }
        }
    }
    for i in 0..faces {
        for j in 0..3 {
            if false_edges[3 * i + j] == NONE {
                continue;
            }
            let (a, b) = ((3 * i + j) as u32, (3 * i + (j + 1) % 3) as u32);
            if corners.root(a) != corners.root(b) {
                return Err(invalid_data(
                    "a false edge's corners are joined only by false edges",
                ));
            }
        }
    }
    Ok(())
}

/// The stretch bound checked.
pub(super) fn check_stretch(stretch: f32) -> crate::Result<()> {
    let above = stretch > 1.0;
    if above || stretch < 0.0 {
        return Err(invalid_argument("the stretch bound lies outside [0, 1]"));
    }
    Ok(())
}
