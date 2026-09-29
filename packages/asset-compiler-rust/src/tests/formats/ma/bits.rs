//! Output bits of the Maya driver, pinned to what the compiler wrote before #1150 (merge base
//! `8912566d6`): a parent and a child posed at angles no axis rounds for free, carrying a skewed
//! smooth roof. A digest that moves means a Maya file compiles to other bits: an output change,
//! never a clean-up.
use super::driver::{compile_ma, normals};

/// What the pre-#1150 compiler wrote for this scene.
const PINNED: &str = "20174f4eef20c3efeaba83140a934cef97df2bf992cb913b02174953bd18b707";

/// A posed parent, a posed child under it, and the child's roof of two soft-edged quads.
const SCENE: &str = "createNode transform -n \"Base\";\n\
    \tsetAttr \".t\" -type \"double3\" 1.25 -3.5 0.75;\n\
    \tsetAttr \".r\" -type \"double3\" 17.3 -31.1 73.9;\n\
    \tsetAttr \".ro\" 3;\n\
    \tsetAttr \".s\" -type \"double3\" 1.1 0.9 1.3;\n\
    createNode transform -n \"Piece\" -p \"Base\";\n\
    \tsetAttr \".t\" -type \"double3\" -0.4 2.2 0.3;\n\
    \tsetAttr \".ra\" -type \"double3\" 12.5 -7.25 3.1;\n\
    \tsetAttr \".r\" -type \"double3\" -41.7 22.2 -5.9;\n\
    \tsetAttr \".sh\" -type \"double3\" 0.1 -0.2 0.05;\n\
    \tsetAttr \".s\" -type \"double3\" 0.7 1.9 1.05;\n\
    createNode mesh -n \"PieceShape\" -p \"Piece\";\n\
    \tsetAttr -s 6 \".vt[0:5]\" -type \"float3\" 0 0.1 0.03  0.2 1.3 -0.1  1.1 0.05 0.93  0.97 1.17 1.21  2.3 -0.2 0.1  2.1 0.9 -0.05;\n\
    \tsetAttr -s 7 \".ed[0:6]\" 0 2 0  2 3 0  3 1 0  1 0 0  2 4 0  4 5 0  5 3 0;\n\
    \tsetAttr -s 2 \".fc[0:1]\" -type \"polyFaces\"\n\
    \t\tf 4 0 1 2 3\n\
    \t\tf 4 4 5 6 -2;\n";

// Audit of #940: the posed nodes' matrices (double bits) and the roof's normals (single bits)
// keep what the pre-#1150 compiler wrote.
#[test]
fn a_posed_maya_scene_compiles_to_the_bits_of_the_pre_1150_compiler() {
    let run = compile_ma("ma-bits", SCENE);
    let (_, gltf) = run.prepared("ma");
    let mut bytes: Vec<u8> = gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter_map(|node| node["matrix"].as_array())
        .flatten()
        .flat_map(|value| value.as_f64().expect("a number").to_bits().to_le_bytes())
        .collect();
    let written = normals(&run, &gltf, &gltf["meshes"][0]["primitives"][0]);
    bytes.extend(
        written
            .iter()
            .flatten()
            .flat_map(|part| part.to_bits().to_le_bytes()),
    );
    assert_eq!(
        crate::compiler_validate::hash(&bytes),
        PINNED,
        "{:?} {written:?}",
        gltf["nodes"]
    );
}
