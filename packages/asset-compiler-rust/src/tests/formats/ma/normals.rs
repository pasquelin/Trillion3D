//! What Maya mesh edges say about smoothing. Maya writes no smoothing group:
//! hardness flag of each edge, third number of `.ed`, says where
//! continuity breaks —, `.n`, when present, decides instead.
use super::driver::{close, compile_ma, normals};

use crate::tests::fixtures::{ROOF_LEFT as LEFT, ROOF_RIGHT as RIGHT};

/// Roof of two quads sharing ridge edge `.ed[1]`, hard or soft. Both
/// slopes same area: average at ridge exactly vertical.
fn roof(ridge: u8) -> String {
    format!(
        "createNode transform -n \"Toit\";\n\
         createNode mesh -n \"ToitShape\" -p \"Toit\";\n\
         \tsetAttr -s 6 \".vt[0:5]\" -type \"float3\" 0 0 0  0 1 0  1 0 1  1 1 1  2 0 0  2 1 0;\n\
         \tsetAttr -s 7 \".ed[0:6]\" 0 2 0  2 3 {ridge}  3 1 0  1 0 0  2 4 0  4 5 0  5 3 0;\n\
         \tsetAttr -s 2 \".fc[0:1]\" -type \"polyFaces\"\n\
         \t\tf 4 0 1 2 3\n\
         \t\tf 4 4 5 6 -2;\n"
    )
}

// Finding 22: soft and hard edges of Maya mesh were lost, all normals
// computed flat. Soft edge now continues smoothing face to face,
// vertices carrying it no longer written twice.
#[test]
fn a_soft_edge_carries_the_shading_from_one_face_to_the_next() {
    let run = compile_ma("ma-arete-douce", &roof(0));
    let (manifest, gltf) = run.prepared("ma");
    let part = &gltf["meshes"][0]["primitives"][0];
    let written = normals(&run, &gltf, part);
    assert_eq!(
        written.len(),
        6,
        "six vertices: the ridge is no longer written twice"
    );
    for rank in [1, 2] {
        assert!(
            close(written[rank], [0.0, 0.0, 1.0]),
            "the ridge averages both slopes: {written:?}"
        );
    }
    assert!(close(written[0], LEFT), "{written:?}");
    assert!(close(written[4], RIGHT), "{written:?}");
    assert_eq!(manifest["unsupported"]["ma-normals-computed"], 1);
}

// Finding 22, other end: third `.ed` number marks hard edge. Roof ridge
// keeps slope of own side on each side, vertex written twice —
// sharp edge not rounded.
#[test]
fn a_hard_edge_splits_the_shading_of_the_two_faces_it_separates() {
    let run = compile_ma("ma-arete-dure", &roof(1));
    let (_, gltf) = run.prepared("ma");
    let part = &gltf["meshes"][0]["primitives"][0];
    let written = normals(&run, &gltf, part);
    assert_eq!(written.len(), 8, "the ridge is split: two extra vertices");
    for rank in 0..4 {
        assert!(close(written[rank], LEFT), "{written:?}");
        assert!(close(written[rank + 4], RIGHT), "{written:?}");
    }
}
