//! The root chart's vertices and faces from the input's corners and adjacency.
//!
//! The corners are numbered by fans: each corner not yet numbered starts a walk around its fan of
//! faces (`walk`), and every corner the walk passes takes the next number. The faces an edge must
//! split are cut free (`split`), the source's adjacency cut with them, and the numbering is redone
//! from scratch until nothing splits. Each new vertex then copies the input vertex of the first
//! corner, in face order, that carries its number.
use super::split::split_shared_edges;
use super::walk::Walk;
use crate::hlod::flatten::uv::spectral::fail::invalid_data;
use crate::hlod::flatten::uv::spectral::mesh::NONE;
use crate::hlod::flatten::uv::spectral::source::Source;

/// The root chart's vertices, each with its input vertex, and faces, each with its three new
/// vertices.
pub(crate) struct RootLayout {
    pub roots: Vec<u32>,
    pub corners: Vec<[u32; 3]>,
}

/// The corners numbered by fans through `adjacency`, and how many numbers were given.
fn number_fans(adjacency: &[u32], corners: &mut [u32]) -> crate::Result<u32> {
    let face_count = corners.len() / 3;
    corners.fill(NONE);
    let mut walk = Walk::new(adjacency);
    let mut count = 0;
    for face in 0..face_count as u32 {
        for corner in 0..3 {
            if corners[(face * 3 + corner) as usize] != NONE {
                continue;
            }
            if !walk.start(face, corner, face_count) {
                return Err(invalid_data("the face adjacency is inconsistent"));
            }
            let center = count;
            count += 1;
            loop {
                corners[(walk.face() * 3 + walk.corner()) as usize] = center;
                if !(walk.has_next() && walk.step()) {
                    break;
                }
            }
        }
    }
    Ok(count)
}

/// The root chart's layout from the input's `indices`, the source's adjacency cut where faces
/// were split.
pub(crate) fn root_layout(source: &mut Source, indices: &[u32]) -> crate::Result<RootLayout> {
    let mut corners = vec![NONE; indices.len()];
    let false_edges = source.false_edges.as_deref();
    let count = loop {
        let mut count = number_fans(&source.adjacency, &mut corners)?;
        if !split_shared_edges(false_edges, &mut source.adjacency, &mut corners, &mut count) {
            break count;
        }
    };
    let mut roots = vec![NONE; count as usize];
    for (corner, &vertex) in corners.iter().enumerate() {
        if roots[vertex as usize] == NONE {
            roots[vertex as usize] = indices[corner];
        }
    }
    let corners = corners.as_chunks::<3>().0.to_vec();
    Ok(RootLayout { roots, corners })
}
