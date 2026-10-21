//! The faces the root chart must cut free: those on an edge that more than two faces name, or on
//! an edge whose two faces the adjacency does not join.
//!
//! Edges are keyed by their lesser vertex and listed under it with the faces that named them, in
//! face order. The second face naming an edge joins it when the adjacency agrees; a third face, or
//! a second the adjacency does not join, marks the edge split. The face that found the split, with
//! every face its false edges reach (depth first, each face once), and the edge's own faces, are
//! listed once each in the order met. Every listed face then gets three fresh vertices, and loses
//! its adjacency across every true edge, on both sides.
use crate::hlod::flatten::uv::spectral::mesh::NONE;

/// An edge met so far, under its lesser vertex.
struct Met {
    peer: u32,
    faces: [u32; 2],
    split: bool,
}

/// Whether the adjacency joins faces `a` and `b`.
fn joined(adjacency: &[u32], a: u32, b: u32) -> bool {
    adjacency[3 * a as usize..3 * a as usize + 3].contains(&b)
}

/// The edge to `peer` in `list`, met again by `face`: whether it must split, and its slot. A first
/// meeting is recorded and needs no split.
fn needs_split(list: &mut Vec<Met>, peer: u32, face: u32, adjacency: &[u32]) -> (bool, usize) {
    if let Some(slot) = list.iter().position(|m| m.peer == peer) {
        let met = &mut list[slot];
        if met.split || met.faces[1] != NONE || !joined(adjacency, met.faces[0], face) {
            return (true, slot);
        }
        met.faces[1] = face;
        return (false, slot);
    }
    list.push(Met {
        peer,
        faces: [face, NONE],
        split: false,
    });
    (false, list.len() - 1)
}

/// The faces to cut, in the order met, and which faces they hold.
struct Cut {
    list: Vec<u32>,
    held: Vec<bool>,
}

impl Cut {
    /// `face` appended unless already there; whether it was.
    fn add(&mut self, face: u32) -> bool {
        if self.held[face as usize] {
            return false;
        }
        self.held[face as usize] = true;
        self.list.push(face);
        true
    }

    /// `face` and every face its false edges reach, depth first, appended once each.
    fn add_false_edge_reach(&mut self, adjacency: &[u32], false_edges: Option<&[u32]>, face: u32) {
        if !self.add(face) {
            return;
        }
        let Some(false_edges) = false_edges else {
            return;
        };
        let mut stack = vec![(face, 0usize)];
        while let Some((at, side)) = stack.pop() {
            if side == 3 {
                continue;
            }
            stack.push((at, side + 1));
            let slot = at as usize * 3 + side;
            if false_edges[slot] != NONE && self.add(adjacency[slot]) {
                stack.push((adjacency[slot], 0));
            }
        }
    }
}

/// The faces of `corners` cut free where an edge must split, `vertex_count` grown by their fresh
/// vertices; whether any face was cut.
pub(super) fn split_shared_edges(
    false_edges: Option<&[u32]>,
    adjacency: &mut [u32],
    corners: &mut [u32],
    vertex_count: &mut u32,
) -> bool {
    let face_count = corners.len() / 3;
    let mut cut = Cut {
        list: Vec::new(),
        held: vec![false; face_count],
    };
    let mut met: Vec<Vec<Met>> = (0..*vertex_count).map(|_| Vec::new()).collect();
    for face in 0..face_count as u32 {
        for k in 0..3 {
            let mut a = corners[face as usize * 3 + k];
            let mut b = corners[face as usize * 3 + (k + 1) % 3];
            if a > b {
                std::mem::swap(&mut a, &mut b);
            }
            let (split, slot) = needs_split(&mut met[a as usize], b, face, adjacency);
            if !split {
                continue;
            }
            cut.add_false_edge_reach(adjacency, false_edges, face);
            let edge = &mut met[a as usize][slot];
            if !edge.split {
                cut.add(edge.faces[0]);
                if edge.faces[1] != NONE {
                    cut.add(edge.faces[1]);
                }
                edge.split = true;
            }
        }
    }
    for &face in &cut.list {
        let base = face as usize * 3;
        for k in 0..3 {
            corners[base + k] = *vertex_count;
            *vertex_count += 1;
            let across = adjacency[base + k];
            let true_edge = false_edges.is_none_or(|f| f[base + k] == NONE);
            if across == NONE || !true_edge {
                continue;
            }
            adjacency[base + k] = NONE;
            for side in &mut adjacency[across as usize * 3..across as usize * 3 + 3] {
                if *side == face {
                    *side = NONE;
                }
            }
        }
    }
    !cut.list.is_empty()
}
