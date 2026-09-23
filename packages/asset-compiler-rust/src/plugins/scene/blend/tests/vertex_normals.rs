//! Normals of a Blender mesh: sharp faces, smooth faces, and the edges the file marks hard. A
//! roof of two slopes is enough to separate all three.
use super::*;

/// A roof of two quads that share the ridge edge, `v2`–`v3`. Both slopes have the same area:
/// their average at the ridge is therefore exactly vertical, which reads by eye.
fn roof(sharp_faces: Vec<bool>, sharp_corners: Vec<bool>) -> Geometry {
    Geometry {
        positions: vec![
            0.0, 0.0, 0.0, // v0, left eave
            0.0, 1.0, 0.0, // v1
            1.0, 0.0, 1.0, // v2, ridge
            1.0, 1.0, 1.0, // v3
            2.0, 0.0, 0.0, // v4, right eave
            2.0, 1.0, 0.0, // v5
        ],
        corners: vec![0, 2, 3, 1, 2, 4, 5, 3],
        offsets: vec![0, 4, 8],
        uv: Vec::new(),
        material: vec![0, 0],
        sharp: sharp_faces,
        sharp_corners,
    }
}

/// The normal of a corner, as the shared computation yields it.
fn corner(shaded: &[f32], rank: usize) -> [f32; 3] {
    [shaded[rank * 3], shaded[rank * 3 + 1], shaded[rank * 3 + 2]]
}

/// Do two normals look alike to a millionth?
fn close(left: [f32; 3], right: [f32; 3]) -> bool {
    (0..3).all(|axis| (left[axis] - right[axis]).abs() < 1e-6)
}

/// The slope of a roof side, of length one: it is the flat normal of each face of the roof.
use crate::tests::fixtures::{ROOF_LEFT as LEFT, ROOF_RIGHT as RIGHT};

// Behaviour: a sharp face keeps its own normal on each of its corners; two smooth faces that
// share a soft edge average theirs on the corners of that edge.
#[test]
fn sharp_faces_keep_their_own_normal_and_smooth_faces_share_it() {
    let flat = normals::corners(&roof(vec![true, true], Vec::new()).surface()).normals;
    assert_eq!(flat.len(), 24);
    for rank in 0..4 {
        assert!(close(corner(&flat, rank), LEFT), "{flat:?}");
        assert!(close(corner(&flat, rank + 4), RIGHT), "{flat:?}");
    }
    let smooth = normals::corners(&roof(vec![false, false], Vec::new()).surface()).normals;
    // The four ridge corners — `v2` and `v3` in each of the two faces — average the two slopes:
    // their normal is vertical.
    for rank in [1, 2, 4, 7] {
        assert!(close(corner(&smooth, rank), [0.0, 0.0, 1.0]), "{smooth:?}");
    }
    // The eaves only touch one slope: they keep its grade.
    for rank in [0, 3] {
        assert!(close(corner(&smooth, rank), LEFT), "{smooth:?}");
    }
    for rank in [5, 6] {
        assert!(close(corner(&smooth, rank), RIGHT), "{smooth:?}");
    }
}

// Finding 22: an edge marked hard separates the two faces it borders, even smooth ones. The
// roof ridge yielded a vertical normal on both sides — a sharp edge rounded —, whereas the file
// declares it hard: each slope now keeps its own grade on its four corners.
#[test]
fn a_hard_edge_splits_the_normals_of_the_two_smooth_faces_it_borders() {
    // The ridge edge leaves corner 1 in the first face and corner 7 in the second.
    let mut hard = vec![false; 8];
    hard[1] = true;
    hard[7] = true;
    let shaded = normals::corners(&roof(vec![false, false], hard).surface());
    for rank in 0..4 {
        assert!(
            close(corner(&shaded.normals, rank), LEFT),
            "the left slope keeps its grade: {:?}",
            shaded.normals
        );
        assert!(
            close(corner(&shaded.normals, rank + 4), RIGHT),
            "the right slope keeps its own: {:?}",
            shaded.normals
        );
    }
    assert_ne!(
        shaded.groups[1], shaded.groups[7],
        "the two ridge corners are no longer of the same fan"
    );
}

// Finding 22, file side: it is indeed the fixture's `sharp_edge` attribute that decides. The
// same fixture, once with all edges soft and once with all edges hard, yielded exactly the same
// mesh: the file's mark was never read.
#[test]
fn the_sharp_edge_attribute_of_the_file_changes_the_normals_it_computes() {
    let vertices = |bytes: &[u8], tag: &str| {
        let gltf = output::compiled(bytes, tag).0;
        let accessors = gltf["accessors"].clone();
        gltf["meshes"]
            .as_array()
            .expect("meshes")
            .iter()
            .flat_map(|mesh| mesh["primitives"].as_array().expect("primitives"))
            .filter_map(|part| part["attributes"]["NORMAL"].as_u64())
            .map(|rank| accessors[rank as usize]["count"].as_u64().expect("count"))
            .sum::<u64>()
    };
    let soft = vertices(&surgery::with_sharp_edges(false), "aretes-douces");
    let hard = vertices(&surgery::with_sharp_edges(true), "aretes-dures");
    assert!(
        hard > soft,
        "all-hard edges split the normals, therefore write more vertices: {soft} against {hard}"
    );
}
