//! Where each corner's normal of a Maya surface comes from.
//!
//! A `.ma` writes its normals in three ways, and only one at a time. `.n` gives one per vertex, or
//! one per face corner: those are Maya's, and they are taken as-is. Without them, geometry gives
//! them — and it is each edge's **hardness flag**, the third number of `.ed`, that says where
//! continuity cuts. Computing them flat as if every edge were hard rendered a faceted sphere;
//! smoothing everywhere would have rounded every sharp edge. The file says it, edge by edge.
use super::*;
use crate::plugins::scene::{cancel, normals};

/// Fills the surface normals and says where each corner reads its own.
pub(super) fn fill(
    world: &mut World<'_>,
    surface: &mut Surface,
    mesh: &Node,
    polygons: &[faces::Face],
    edges: &[[f64; 3]],
) -> Option<()> {
    let corners: usize = polygons.iter().map(|face| face.edges.len()).sum();
    let written: Vec<[f64; 3]> =
        value::elements(mesh.attr(&["n", "normal"]).map_or(&[][..], Attr::numbers)).collect();
    for (count, shading) in [
        (surface.positions.len(), Shading::Vertex),
        (corners, Shading::Corner),
    ] {
        if written.len() == count {
            surface.normals = written;
            surface.shading = shading;
            return Some(());
        }
    }
    if !written.is_empty() {
        world.refuse(report::NORMALS_DROPPED);
    }
    world.refuse(report::NORMALS_COMPUTED);
    compute(surface, polygons, edges, corners, world.cancelled)
}

/// Computes normals from geometry and places each corner at the slot `.fc` gives it — the same
/// as corner-written normals, so the reader knows only one layout.
fn compute(
    surface: &mut Surface,
    polygons: &[faces::Face],
    edges: &[[f64; 3]],
    corners: usize,
    cancelled: &std::sync::atomic::AtomicBool,
) -> Option<()> {
    let mut positions = Vec::with_capacity(surface.positions.len() * 3);
    for (rank, point) in surface.positions.iter().enumerate() {
        if cancel::stopped(cancelled, rank) {
            return None;
        }
        positions.extend(point.map(|axis| axis as f32));
    }
    let (mut ring, mut offsets, mut hard) = (Vec::new(), vec![0u32], Vec::new());
    for (face, loops) in surface.loops.iter().enumerate() {
        if cancel::stopped(cancelled, face) {
            return None;
        }
        let written = polygons.get(face).map_or(&[][..], |face| &face.edges);
        for (rank, vertex) in loops.iter().enumerate() {
            if cancel::stopped(cancelled, ring.len()) {
                return None;
            }
            ring.push(*vertex);
            hard.push(is_hard(edges, written.get(rank).copied()));
        }
        offsets.push(ring.len() as u32);
    }
    let shaded = normals::corners(
        &normals::Surface {
            positions: &positions,
            corners: &ring,
            offsets: &offsets,
            sharp_faces: &[],
            sharp_corners: &hard,
        },
        cancelled,
    )?;
    surface.normals = vec![[0.0, 1.0, 0.0]; corners];
    surface.groups = vec![0; corners];
    let mut at = 0usize;
    for (face, loops) in surface.loops.iter().enumerate() {
        if cancel::stopped(cancelled, face) {
            return None;
        }
        for rank in 0..loops.len() {
            if cancel::stopped(cancelled, at + rank) {
                return None;
            }
            let Some(into) = surface.bases.get(face).map(|base| base + rank) else {
                continue;
            };
            let read = |axis: usize| shaded.normals[(at + rank) * 3 + axis] as f64;
            surface.normals[into] = [read(0), read(1), read(2)];
            surface.groups[into] = shaded.groups[at + rank];
        }
        at += loops.len();
    }
    surface.shading = Shading::Corner;
    (!cancel::stopped(cancelled, 0)).then_some(())
}

/// Is the edge this corner carries hard? Maya writes three numbers per edge — its two vertices,
/// then the flag — and a face cites its signed edges: `-(i + 1)` walks it backwards, which does
/// not change its hardness. The lowest value of a signed integer has no opposite, so it names no
/// edge; the whole face is already counted elsewhere under `ma-mesh-invalid`.
fn is_hard(edges: &[[f64; 3]], signed: Option<i64>) -> bool {
    signed
        .and_then(super::edge_rank)
        .and_then(|(rank, _)| edges.get(rank))
        .is_some_and(|edge| edge[2] != 0.0)
}
