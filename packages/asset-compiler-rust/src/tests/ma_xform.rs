//! La pose d'un `transform` de Maya, telle que le fichier l'écrit : par composantes séparées, avec
//! un axe de rotation, un cisaillement, une matrice de père décalé, ou sans héritage du père.
//!
//! Le reste de la fidélité du pilote est dans `ma_fidelite.rs`.
use super::*;
use ma_driver::{compile_ma, matrix, quad};
use unity_projet::node_named;

/// Un transform nommé qui porte les attributs donnés et un carré, sous le père donné quand il y en a.
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

/// La matrice du nœud de ce nom dans la scène que ce corps décrit.
fn posed_matrix(tag: &str, name: &str, attributes: &str) -> Vec<f64> {
    let run = compile_ma(tag, &posed(name, "", attributes));
    let (_, gltf) = run.prepared("ma");
    matrix(node_named(&gltf, name).expect("le nœud posé"))
}

// Constat 13 : Maya écrit une pose par composantes — `.tx`, `.ry`, `.sz` — aussi souvent que par
// attribut composé. Les ignorer laissait le nœud à l'origine ; elles donnent la même matrice.
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
    assert_eq!(split, whole, "`.tx` pose le nœud comme le premier de `.t`");
}

// Constat 13 : `rotateAxis` est une orientation de l'axe local, appliquée au point **avant** la
// rotation. Elle était ignorée ; composée, elle ne commute pas avec `rotate`.
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

// Constat 13 : le cisaillement de Maya est un vecteur `(XY, XZ, YZ)` qui se compose entre le pivot
// d'échelle et l'échelle. Une matrice de nœud glTF le porte tel quel.
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

// Constat 13 : `offsetParentMatrix` s'applique **après** la pose locale, comme un père de plus.
// Une matrice écrite autrement que par ses seize nombres n'est pas devinée, elle est comptée.
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
        "la translation locale passe par la matrice du père décalé"
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
        "la forme longue d'une matrice est comptée, jamais lue de travers"
    );
}

// Constat 13 : `inheritsTransform = 0` coupe l'héritage — le nœud se pose dans le repère de la
// scène, la pose de son père ne le suit pas.
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
            .unwrap_or_else(|| panic!("le nœud {name}"))
    };
    let children = |name: &str| {
        nodes[rank(name)]["children"]
            .as_array()
            .map(|ranks| ranks.iter().filter_map(Value::as_u64).collect::<Vec<u64>>())
            .unwrap_or_default()
    };
    assert!(
        !children("Pere").contains(&(rank("Libre") as u64)),
        "le nœud sans héritage ne pend plus sous son père"
    );
    assert!(
        children("ma-root").contains(&(rank("Libre") as u64)),
        "il pend sous la racine de la scène, qui ne porte que l'unité"
    );
    assert_eq!(
        matrix(&nodes[rank("Libre")])[12..15],
        [1., 0., 0.],
        "sa pose est celle que le fichier lui donne, sans celle de son père"
    );
}
