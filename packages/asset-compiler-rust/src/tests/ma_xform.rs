//! Maya `transform` pose as file writes: separate components, rotation axis,
//! shear, offset parent matrix, or no parent inheritance.
//!
//! Rest of driver fidelity in `ma_fidelite.rs`.
use super::*;
use ma_driver::{compile_ma, matrix, quad};
use unity_projet::node_named;

/// Named transform carrying given attributes and square, under given parent.
fn posed(name: &str, parent: &str, attributes: &str) -> String {
    let under = match parent {
        "" => String::new(),
        _ => format!(" -p \"{parent}\""),
    };
    format!(
        "createNode transform -n \"{name}\"{under};\n{attributes}{}",
        quad(&format!("{name}Shape"), name)
    )
}

/// Node matrix of this name in scene.
fn posed_matrix(tag: &str, name: &str, attributes: &str) -> Vec<f64> {
    let run = compile_ma(tag, &posed(name, "", attributes));
    let (_, gltf) = run.prepared("ma");
    matrix(node_named(&gltf, name).expect("the posed node"))
}

// Finding 13: Maya writes pose per component — `.tx`, `.ry`, `.sz` — as often as
// compound attribute. Ignoring left node at origin; yields same matrix.
#[test]
fn the_single_components_of_a_transform_pose_it_like_the_compound_attributes() {
    let split = posed_matrix(
        "ma-composantes",
        "Piece",
        "\tsetAttr \".tx\" 10;\n\tsetAttr \".ry\" 90;\n\tsetAttr \".sz\" 2;\n",
    );
    let whole = posed_matrix(
        "ma-composee",
        "Piece",
        "\tsetAttr \".t\" -type \"double3\" 10 0 0;\n\
         \tsetAttr \".r\" -type \"double3\" 0 90 0;\n\
         \tsetAttr \".s\" -type \"double3\" 1 1 2;\n",
    );
    assert_ne!(whole, crate::compiler_world::IDENTITY.to_vec());
    assert_eq!(split, whole, "`.tx` poses the node like the first of `.t`");
}

// Finding 13: `rotateAxis` local axis orientation, applied to point **before**
// rotation. Was ignored; composed, does not commute with `rotate`.
#[test]
fn a_rotate_axis_turns_the_point_before_the_rotation() {
    let turned = posed_matrix(
        "ma-axe-rotation",
        "Piece",
        "\tsetAttr \".ra\" -type \"double3\" 90 0 0;\n\
         \tsetAttr \".r\" -type \"double3\" 0 90 0;\n",
    );
    assert_eq!(
        turned,
        vec![0., 0., -1., 0., 1., 0., 0., 0., 0., -1., 0., 0., 0., 0., 0., 1.],
        "la matrice est `rotate · rotateAxis`, jamais l'inverse"
    );
}

// Finding 13: Maya shear vector `(XY, XZ, YZ)` composes between scale pivot
// and scale. glTF node matrix carries as is.
#[test]
fn a_shear_is_composed_into_the_node_matrix() {
    let sheared = posed_matrix(
        "ma-cisaillement",
        "Piece",
        "\tsetAttr \".sh\" -type \"double3\" 1 0 0;\n",
    );
    assert_eq!(
        sheared,
        vec![1., 0., 0., 0., 1., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.],
        "`shearXY` penche l'axe Y vers X"
    );
}

// Finding 13: `offsetParentMatrix` applies **after** local pose, like extra parent.
// Matrix written otherwise than 16 numbers not guessed, counted.
#[test]
fn an_offset_parent_matrix_applies_after_the_local_pose() {
    let offset = posed_matrix(
        "ma-pere-decale",
        "Piece",
        "\tsetAttr \".opm\" -type \"matrix\" 2 0 0 0  0 2 0 0  0 0 2 0  0 0 0 1;\n\
         \tsetAttr \".t\" -type \"double3\" 10 0 0;\n",
    );
    assert_eq!(
        offset,
        vec![2., 0., 0., 0., 0., 2., 0., 0., 0., 0., 2., 0., 20., 0., 0., 1.],
        "local translation goes through the shifted parent's matrix"
    );
    let run = compile_ma(
        "ma-matrice-xform",
        &posed(
            "Piece",
            "",
            "\tsetAttr \".opm\" -type \"matrix\" \"xform\" 1 1 1 0 0 0 0 0 0 0;\n",
        ),
    );
    assert_eq!(
        run.prepared("ma").0["unsupported"]["ma-matrix-unsupported"],
        1,
        "the long form of a matrix is counted, never misread"
    );
}

// Finding 13: `inheritsTransform = 0` cuts inheritance — node poses in scene
// frame, parent pose does not follow.
#[test]
fn a_node_that_does_not_inherit_its_transform_leaves_its_parent_behind() {
    let body = format!(
        "{}{}",
        posed("Pere", "", "\tsetAttr \".t\" -type \"double3\" 100 0 0;\n"),
        posed(
            "Libre",
            "Pere",
            "\tsetAttr \".it\" no;\n\tsetAttr \".t\" -type \"double3\" 1 0 0;\n"
        ),
    );
    let run = compile_ma("ma-sans-heritage", &body);
    let (_, gltf) = run.prepared("ma");
    let nodes = gltf["nodes"].as_array().expect("nodes");
    let rank = |name: &str| {
        nodes
            .iter()
            .position(|node| node["name"] == name)
            .unwrap_or_else(|| panic!("the node {name}"))
    };
    let children = |name: &str| {
        nodes[rank(name)]["children"]
            .as_array()
            .map(|ranks| ranks.iter().filter_map(Value::as_u64).collect::<Vec<u64>>())
            .unwrap_or_default()
    };
    assert!(
        !children("Pere").contains(&(rank("Libre") as u64)),
        "the node without inheritance no longer hangs under its parent"
    );
    assert!(
        children("ma-root").contains(&(rank("Libre") as u64)),
        "it hangs under the scene root, which carries only the unit"
    );
    assert_eq!(
        matrix(&nodes[rank("Libre")])[12..15],
        [1., 0., 0.],
        "its pose is the one the file gives it, without its parent's"
    );
}
