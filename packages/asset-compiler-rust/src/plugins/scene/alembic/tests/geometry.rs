//! What splitting a read geometry produces: triangulation, face sets, topology refusals.
//!
//! Real archives go through the golden; here, geometry is given by hand, face by face.
use super::super::geom::Geometry;
use super::super::mesh::{parts, FaceSet};
use super::super::TOPOLOGY_INVALID;
use crate::tests::ngons::{rendered_area, U_RING};
use std::sync::atomic::AtomicBool;

/// A cancellation token never raised: these cases measure the split, not the stop.
fn running() -> AtomicBool {
    AtomicBool::new(false)
}

/// A mesh of three faces on six positions: a triangle, a pentagon, and a two-sided face, which
/// carries no surface.
fn three_faces() -> Geometry {
    Geometry {
        positions: (0..18).map(|value| value as f32).collect(),
        counts: vec![3, 5, 2],
        corners: vec![0, 1, 2, 0, 1, 2, 3, 4, 0, 1],
        normals: None,
        uv: None,
        dropped: Vec::new(),
    }
}

// Behaviour: a face of more than three sides is fanned, in the reverse of the order Alembic
// writes, and each face set becomes a separate part. A face claimed twice stays with the first
// face set, and a face of fewer than three sides is counted without being rendered.
#[test]
fn faces_are_fanned_backwards_and_split_by_face_set() {
    let facesets = [
        FaceSet {
            name: "A".into(),
            faces: vec![1],
        },
        FaceSet {
            name: "B".into(),
            faces: vec![1, 0],
        },
    ];
    let (parts, counted) = parts(&three_faces(), &facesets, &running()).expect("parts");
    assert_eq!(counted.overlaps, 1, "face 1 is claimed twice");
    assert_eq!(counted.degenerate, 1, "the two-sided face is counted");
    assert_eq!(parts.len(), 2, "one part per served face set");
    assert_eq!(parts[0].faceset, Some(0));
    // Pentagon 0,1,2,3,4 read backwards gives 4,3,2,1,0, cut into three triangles.
    assert_eq!(parts[0].indices, [0, 1, 2, 0, 2, 3, 0, 3, 4]);
    assert_eq!(
        parts[0].positions[..3],
        [12.0, 13.0, 14.0],
        "corner 4 first"
    );
    assert_eq!(parts[1].faceset, Some(1));
    assert_eq!(parts[1].indices, [0, 1, 2], "triangle 0,1,2 read backwards");
    assert_eq!(parts[1].positions[..3], [6.0, 7.0, 8.0], "corner 2 first");
}

// Behaviour: a face index outside the position table is a file that contradicts itself, refused
// by name rather than read outside what it carries.
#[test]
fn a_face_index_outside_the_positions_is_refused_by_name() {
    let mut geometry = three_faces();
    geometry.corners[0] = 99;
    let refusal = parts(&geometry, &[], &running())
        .err()
        .expect("this topology was expected to be refused");
    assert_eq!(refusal.code, TOPOLOGY_INVALID);
}

// Behaviour: a concave polygon keeps exactly the area it carries. Fanning from the first corner
// crossed the U's hollow and yielded eleven for seven; ears yield seven.
#[test]
fn a_concave_polygon_keeps_its_own_area() {
    let geometry = Geometry {
        positions: U_RING
            .iter()
            .flat_map(|[x, y]| [*x as f32, *y as f32, 0.0])
            .collect(),
        counts: vec![8],
        corners: (0..8).collect(),
        normals: None,
        uv: None,
        dropped: Vec::new(),
    };
    let (parts, counted) = parts(&geometry, &[], &running()).expect("parts");
    assert_eq!(counted.uncut, 0, "a simple U cuts entirely");
    assert_eq!(parts.len(), 1, "a single part, with no face set");
    assert_eq!(
        parts[0].indices.len(),
        18,
        "eight corners make six triangles"
    );
    let area = rendered_area(&parts[0].positions, &parts[0].indices);
    assert!(
        (area - 7.0).abs() < 1e-5,
        "rendered area {area}, expected 7"
    );
}

// Finding 27: cancellation is reread inside a mesh. Checked between objects only, a single mesh
// of a million faces posed them all before stopping.
#[test]
fn a_raised_token_stops_a_mesh_before_its_last_face() {
    let Err(refusal) = parts(&three_faces(), &[], &AtomicBool::new(true)) else {
        panic!("the mesh was expected to be abandoned");
    };
    assert_eq!(refusal.code, "CANCELLED");
}
