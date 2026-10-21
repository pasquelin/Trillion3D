//! Step 3 of the tangent spaces (`mikk.rs`): the groups of triangles around each vertex.
//!
//! The kept triangles are read in order, each corner in order. A corner of a good triangle that
//! belongs to no group starts one: its vertex, its triangle's orientation, its triangle the first.
//! The group then grows depth first, the triangle across the edge leaving the corner before the
//! one entering it, each reached triangle first reaching its own two triangles across the edges
//! at the vertex in the same order. A reached triangle whose corner at the vertex already belongs
//! to a group stops there. One grouping with any whose corners belong to no group yet takes the
//! group's orientation; then a triangle whose orientation is not the group's stops there, any
//! other joins it.
use super::faces::{Face, GROUP_WITH_ANY, NONE, ORIENT_PRESERVING};

/// A group of triangles around one vertex.
#[derive(Clone, Debug)]
pub(super) struct Group {
    /// Its triangles, in the order they joined it.
    pub faces: Vec<u32>,
    /// The vertex it lies around.
    pub vertex: u32,
    /// Whether its triangles' texture mapping keeps their orientation.
    pub orient: bool,
}

/// The groups of the kept triangles `faces` over their `vertices`, and per triangle, per corner,
/// the group it belongs to or `NONE` (the module's rule); a triangle grouping with any may take a
/// group's orientation.
pub(super) fn groups(faces: &mut [Face], vertices: &[[u32; 3]]) -> (Vec<Group>, Vec<[u32; 3]>) {
    let mut groups: Vec<Group> = Vec::new();
    let mut assigned = vec![[NONE; 3]; faces.len()];
    let mut reached: Vec<u32> = Vec::new();
    for f in 0..faces.len() {
        for k in 0..3 {
            if faces[f].flags & GROUP_WITH_ANY != 0 || assigned[f][k] != NONE {
                continue;
            }
            let g = groups.len() as u32;
            groups.push(Group {
                faces: vec![f as u32],
                vertex: vertices[f][k],
                orient: faces[f].flags & ORIENT_PRESERVING != 0,
            });
            assigned[f][k] = g;
            push_sides(&mut reached, faces[f].neighbours, k);
            while let Some(t) = reached.pop() {
                let group = &mut groups[g as usize];
                let face = &mut faces[t as usize];
                let corners = vertices[t as usize];
                let Some(at) = corners.iter().position(|&v| v == group.vertex) else {
                    continue;
                };
                if assigned[t as usize][at] != NONE {
                    continue;
                }
                if face.flags & GROUP_WITH_ANY != 0 && assigned[t as usize] == [NONE; 3] {
                    face.flags &= !ORIENT_PRESERVING;
                    if group.orient {
                        face.flags |= ORIENT_PRESERVING;
                    }
                }
                if (face.flags & ORIENT_PRESERVING != 0) != group.orient {
                    continue;
                }
                group.faces.push(t);
                assigned[t as usize][at] = g;
                push_sides(&mut reached, face.neighbours, at);
            }
        }
    }
    (groups, assigned)
}

/// Pushes the triangles across the two edges at corner `k`, the one leaving it read first.
fn push_sides(reached: &mut Vec<u32>, neighbours: [u32; 3], k: usize) {
    let (leaving, entering) = (neighbours[k], neighbours[(k + 2) % 3]);
    reached.extend([entering, leaving].into_iter().filter(|&t| t != NONE));
}
