//! The attribute tables a reduction reads: seams, identical copies, a corner's own normal.
use super::*;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL};

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
// that a face turned its own way draws.
#[test]
fn own_normals_points_a_corner_at_its_face_copy() {
    // A triangle facing +z drawn by copy 3 of corner 0; copy 0 belongs to a face facing -x.
    let positions = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0,
    ];
    let normals = [
        -1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0,
    ];
    let weld_seam = [0u32, 1, 2, 0, 4];
    let mut simplified = vec![0u32, 1, 2];
    let source = [3, 1, 2, 0, 2, 4];
    let foreign =
        attributes::own_normals(&mut simplified, &source, &weld_seam, &positions, &normals);
    assert_eq!(simplified, vec![3, 1, 2]);
    assert!(foreign.is_empty());
}

// Behaviour: a coarse face none of whose corner copies a face turned its way draws — the
// underside of a board laid on its top — is reported, never given another face's normal.
#[test]
fn own_normals_reports_a_face_no_copy_of_which_agrees() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let normals = [0.0, 0.0, 1.0].repeat(3);
    let mut simplified = vec![0u32, 2, 1];
    let foreign = attributes::own_normals(
        &mut simplified,
        &[0, 1, 2],
        &[0, 1, 2],
        &positions,
        &normals,
    );
    assert_eq!(foreign, vec![0, 2, 1]);
}

// Behaviour: a coarse face its source already shades from behind keeps the source's copies when
// the copy one corner prefers alone would turn the mean of its normals further away.
#[test]
fn own_normals_keeps_the_source_shading_of_a_face_lit_from_behind() {
    // A chamfer facing +x (0, 1, 2) whose corners 0 and 1 carry a wall's normal; corner 2's
    // position has a second copy, 3, on a face (3, 4, 5) facing (1, 0, 1), its normal nearer +x.
    let positions = [
        0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0,
    ];
    let normals = [
        -0.75, 0.0, -0.66, -0.75, 0.0, -0.66, 0.65, 0.0, -0.76, 0.76, 0.0, 0.65, 0.71, 0.0, 0.71,
        0.71, 0.0, 0.71,
    ];
    let source = [0, 1, 2, 3, 4, 5];
    let mut simplified = vec![0u32, 1, 3];
    let weld_seam = [0u32, 1, 2, 2, 4, 5];
    let foreign =
        attributes::own_normals(&mut simplified, &source, &weld_seam, &positions, &normals);
    assert_eq!(simplified, vec![0, 1, 2]);
    assert!(foreign.is_empty());
    let deviation = |indices: &[u32]| quality::normal_deviation(indices, &positions, &normals, 0.0);
    assert!(deviation(&simplified) < deviation(&[0, 1, 3]));
}
