//! The attribute tables a reduction reads (#484): seams, identical copies, a corner's own normal.
use super::*;
use crate::geometry_page::{Attribute, FLAG_COLOR, FLAG_NORMAL};

// Behaviour: a position written under two texture coordinates is a seam, all its copies with it.
#[test]
fn seam_vertices_marks_every_copy_of_a_seam_position() {
    // Vertices 0 and 3 share a position under two texture coordinates; 1 and 4 under one.
    let weld = [0u32, 1, 2, 0, 1];
    let weld_seam = [0u32, 1, 2, 3, 1];
    let seams = attributes::seam_vertices(&weld, &weld_seam, &[0, 1, 2, 3, 4, 2]);
    assert_eq!(seams, vec![true, false, false, true, false]);
}

// Behaviour: copies equal in position and in every carried attribute are one vertex; a copy
// differing by its colour alone stays apart.
#[test]
fn weld_exact_joins_only_copies_a_page_cannot_tell_apart() {
    let positions = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    let normals = Attribute {
        flag: FLAG_NORMAL,
        width: 3,
        values: [0.0, 0.0, 1.0].repeat(3),
    };
    let colors = Attribute {
        flag: FLAG_COLOR,
        width: 4,
        values: vec![1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5, 0.5, 0.5, 1.0],
    };
    let exact = attributes::weld_exact(&positions, &[&normals, &colors], &[0, 1, 2]);
    assert_eq!(exact, vec![0, 0, 2]);
}

// Behaviour: a coarse corner merged across a hard edge points back at the copy of its position
// whose normal is its own face's.
#[test]
fn own_normals_points_a_corner_at_its_face_copy() {
    // A triangle facing +z; its corner 0 has a copy 3 at the same place facing -x.
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
    let normals = [-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
    let weld_seam = [0u32, 1, 2, 0];
    let mut simplified = vec![0u32, 1, 2];
    attributes::own_normals(
        &mut simplified,
        &[0, 1, 2, 3, 2, 1],
        &weld_seam,
        &positions,
        &normals,
    );
    assert_eq!(simplified, vec![3, 1, 2]);
}
