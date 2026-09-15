//! Ce que seul l'intérieur du pilote peut prouver : la forme du texte lue par le découpage en
//! commandes, et les règles d'écriture d'un attribut par tranches. Tout le reste — géométrie,
//! matériaux, textures, refus — se prouve depuis la dorée, par le compilateur entier.
use super::*;

/// Le document d'un texte, entête comprise.
fn read_document(body: &str) -> Document {
    document::read(&format!("{HEADER} 2024 scene\n{body}")).expect("document")
}

// Comportement : une chaîne jamais refermée arrête la lecture par un refus nommé, au lieu d'avaler
// le reste du fichier comme s'il faisait partie du nom.
#[test]
fn an_unclosed_string_is_refused_by_name() {
    let error = document::read(&format!("{HEADER}\ncreateNode transform -n \"Sans fin;\n"))
        .err()
        .expect("refus");
    assert_eq!(error.code, FILE_INVALID);
}

// Comportement : un fichier qui ne s'ouvre pas sur l'entête de Maya n'est pas lu.
#[test]
fn a_file_without_the_maya_header_is_refused() {
    let error = document::read("createNode transform -n \"X\";\n")
        .err()
        .expect("refus");
    assert_eq!(error.code, FILE_INVALID);
}

// Comportement : les commentaires des deux formes et les points-virgules vides ne font pas de
// commande, et une commande hors sous-ensemble est comptée sous son propre nom, jamais exécutée.
#[test]
fn a_command_outside_the_subset_is_counted_under_its_own_name() {
    let read = read_document("// un mot\n/* un autre */;;\npython \"print(1)\";\n");
    assert_eq!(read.nodes.len(), 0);
    assert_eq!(
        read.report.unsupported.get("ma-command-ignored:python"),
        Some(&1)
    );
}

// Comportement : un `setAttr` écrit une tranche d'un tableau, la foulée venant du type quand il la
// fixe et du nombre de valeurs par élément de l'intervalle sinon.
#[test]
fn set_attr_writes_one_slice_of_an_array_at_a_time() {
    let read = read_document(concat!(
        "createNode mesh -n \"M\";\n",
        "setAttr -s 2 \".vt[0:1]\" -type \"float3\" 0 0 0  1 0 0;\n",
        "setAttr \".vt[2]\" -type \"float3\" 0 1 0;\n",
        "setAttr -s 3 \".ed[0:2]\" 0 1 0  1 2 0  2 0 0;\n",
    ));
    let mesh = &read.nodes[0];
    assert_eq!(
        mesh.attr(&["vt"]).expect("sommets").numbers(),
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    );
    assert_eq!(
        mesh.attr(&["ed"]).expect("arêtes").numbers(),
        [0.0, 1.0, 0.0, 1.0, 2.0, 0.0, 2.0, 0.0, 0.0]
    );
}

// Comportement : un `setAttr` sans nœud courant est compté, et ne se verse sur aucun nœud au hasard.
#[test]
fn an_attribute_without_a_node_is_counted() {
    let read = read_document("select -ne :time1;\nsetAttr \".o\" 1;\n");
    assert_eq!(
        read.report.unsupported.get(report::ATTRIBUTE_UNATTACHED),
        Some(&1)
    );
}

// Comportement : l'unité linéaire du fichier devient le facteur vers le mètre, et l'unité angulaire
// le facteur vers le degré.
#[test]
fn the_declared_units_become_the_factors_of_the_scene() {
    assert_eq!(
        read_document("currentUnit -l meter;\n").meters_per_unit,
        1.0
    );
    assert_eq!(
        read_document("currentUnit -l inch;\n").meters_per_unit,
        0.0254
    );
    assert!(read_document("currentUnit -a radian;\n").degrees_per_unit > 57.0);
    assert_eq!(read_document("").meters_per_unit, 0.01);
}

// Comportement : une face cite ses arêtes, et son coin de rang `k` est le sommet de départ de la
// `k`-ième — le second sommet quand l'indice est écrit négatif.
#[test]
fn a_face_corner_is_the_start_vertex_of_its_signed_edge() {
    let edges = [[0.0, 1.0, 0.0], [1.0, 2.0, 0.0], [2.0, 0.0, 0.0]];
    assert_eq!(mesh::corner(&edges, 1, 3), Some(1));
    assert_eq!(mesh::corner(&edges, -2, 3), Some(2));
    assert_eq!(mesh::corner(&edges, 9, 3), None);
}

// Comportement : une liste de composants rend les faces qu'elle nomme, et compte ce qui n'en
// nomme aucune.
#[test]
fn a_component_list_names_faces_and_counts_what_is_not_one() {
    let list = [
        "f[0:2]".to_string(),
        "f[5]".to_string(),
        "vtx[1]".to_string(),
    ];
    assert_eq!(faces::components(&list), (vec![0, 1, 2, 5], 1));
}
