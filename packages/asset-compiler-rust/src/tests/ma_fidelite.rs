//! Ce que le fichier Maya ASCII dit de sa scène et que le pilote doit rendre tel quel : deux nœuds
//! homonymes sous deux pères, les faces qu'aucun ensemble ne réclame, et les formes que Maya ne
//! dessine jamais.
//!
//! La pose d'un `transform` a son propre fichier, `ma_xform.rs` ; la scène dorée est dans
//! `ma_golden.rs`.
use super::*;
use ma_driver::{compile_ma, quad, translations};

/// Un maillage de quatre triangles indépendants, de quoi qu'une liaison partielle en laisse.
fn four_triangles(name: &str, parent: &str) -> String {
    let vertices: String = (0..4)
        .map(|face| format!("{face} 0 0  {} 0 0  {face} 1 0  ", face + 1))
        .collect();
    let edges: String = (0..4)
        .flat_map(|face| {
            [(0, 1), (1, 2), (2, 0)].map(|(from, to)| (3 * face + from, 3 * face + to))
        })
        .map(|(from, to)| format!("{from} {to} 0  "))
        .collect();
    let records: String = (0..4)
        .map(|face| format!("\t\tf 3 {} {} {}", 3 * face, 3 * face + 1, 3 * face + 2))
        .collect::<Vec<String>>()
        .join("\n");
    format!(
        "createNode mesh -n \"{name}\" -p \"{parent}\";\n\
         \tsetAttr -s 12 \".vt[0:11]\" -type \"float3\" {vertices};\n\
         \tsetAttr -s 12 \".ed[0:11]\" {edges};\n\
         \tsetAttr -s 4 \".fc[0:3]\" -type \"polyFaces\"\n{records};\n"
    )
}

// Constat 10 : deux transforms nommés `M` sous deux pères différents sont deux nœuds. Maya les
// distingue par leur chemin complet — `|A|M` et `|B|M` —, et les confondre faisait que le second
// écrasait le premier : un `setAttr` visant l'un tombait sur l'autre.
#[test]
fn two_transforms_of_the_same_name_under_two_parents_stay_two_nodes() {
    let body = format!(
        "createNode transform -n \"A\";\n\
         createNode transform -n \"M\" -p \"A\";\n{}\
         createNode transform -n \"B\";\n\
         createNode transform -n \"M\" -p \"B\";\n{}\
         setAttr \"|A|M.t\" -type \"double3\" 10 0 0;\n\
         setAttr \"|B|M.t\" -type \"double3\" 0 20 0;\n",
        quad("AShape", "|A|M"),
        quad("BShape", "|B|M"),
    );
    let run = compile_ma("ma-homonymes", &body);
    assert_eq!(
        run.result["sourceTriangles"], 4,
        "les deux formes homonymes sont rendues"
    );
    let (_, gltf) = run.prepared("ma");
    let moved = translations(&gltf, "M");
    assert_eq!(moved.len(), 2, "chaque père garde son propre `M`");
    assert!(
        moved.contains(&[10.0, 0.0, 0.0]) && moved.contains(&[0.0, 20.0, 0.0]),
        "chaque `setAttr` tombe sur le nœud que son chemin nomme, pas sur l'autre : {moved:?}"
    );
}

// Constat 11 : un `shadingEngine` qui ne réclame qu'une partie des faces ne fait pas disparaître
// les autres. Celles qu'aucun ensemble ne nomme sortent dans une primitive sans matériau, comptées.
#[test]
fn the_faces_no_shading_group_claims_still_reach_the_scene() {
    let body = format!(
        "createNode transform -n \"T\";\n{}\
         \tsetAttr \".iog[0].og[0].gcl\" -type \"componentList\" 1 \"f[0:1]\";\n\
         createNode lambert -n \"Uni\";\n\
         createNode shadingEngine -n \"UniSG\";\n\
         connectAttr \"Uni.oc\" \"UniSG.ss\";\n\
         connectAttr \"TShape.iog.og[0]\" \"UniSG.dsm\" -na;\n",
        four_triangles("TShape", "T"),
    );
    let run = compile_ma("ma-liaison-partielle", &body);
    assert_eq!(
        run.result["sourceTriangles"], 4,
        "les quatre faces sortent, liées ou non"
    );
    let (manifest, gltf) = run.prepared("ma");
    let primitives = gltf["meshes"][0]["primitives"]
        .as_array()
        .expect("primitives");
    assert_eq!(primitives.len(), 2, "une part liée, une part sans matériau");
    assert_eq!(
        primitives
            .iter()
            .filter(|part| part.get("material").is_none())
            .count(),
        1,
        "les faces sans liaison forment une primitive sans matériau"
    );
    assert_eq!(
        manifest["unsupported"]["ma-face-material-missing"], 2,
        "les deux faces qu'aucun ensemble ne réclame sont comptées"
    );
}

// Constat 12 : une forme intermédiaire est un état de travail que Maya ne dessine jamais, et une
// forme invisible est cachée par le fichier. Ni l'une ni l'autre n'entre dans la scène.
#[test]
fn an_intermediate_or_invisible_shape_never_reaches_the_scene() {
    let body = format!(
        "createNode transform -n \"T\";\n{}{}\tsetAttr \".io\" yes;\n{}\tsetAttr \".v\" no;\n",
        quad("TShape", "T"),
        quad("TWork", "T"),
        quad("THidden", "T"),
    );
    let run = compile_ma("ma-formes-cachees", &body);
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "seule la forme que Maya dessine est rendue"
    );
    let (manifest, gltf) = run.prepared("ma");
    let names: Vec<&str> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .filter_map(|mesh| mesh["name"].as_str())
        .collect();
    assert_eq!(names, ["TShape"], "ni la forme de travail ni la cachée");
    assert_eq!(manifest["unsupported"]["ma-shape-intermediate"], 1);
    assert_eq!(manifest["source"]["counts"]["invisible"], 1);
}

// Constat 23 : une face qui cite l'arête `i64::MIN` est refusée sous son nom. Maya écrit `-(i + 1)`
// pour une arête parcourue à l'envers, et la valeur la plus basse n'a pas d'opposé : la nier
// débordait, ce qui arrêtait la compilation par une panique au lieu d'un refus compté.
#[test]
fn a_face_citing_the_lowest_edge_index_is_refused_by_name() {
    let body = format!(
        "createNode transform -n \"T\";\n{}\
         createNode transform -n \"H\";\n\
         createNode mesh -n \"HShape\" -p \"H\";\n\
         \tsetAttr -s 4 \".vt[0:3]\" -type \"float3\" 0 0 0  1 0 0  1 1 0  0 1 0;\n\
         \tsetAttr -s 4 \".ed[0:3]\" 0 1 0  1 2 0  2 3 0  3 0 0;\n\
         \tsetAttr -s 1 \".fc[0:0]\" -type \"polyFaces\"\n\
         \t\tf 4 {} 1 2 3;\n",
        quad("TShape", "T"),
        i64::MIN,
    );
    let run = compile_ma("ma-arete-minimale", &body);
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "seule la forme saine est rendue"
    );
    let (manifest, _) = run.prepared("ma");
    assert_eq!(
        manifest["unsupported"]["ma-mesh-invalid"], 1,
        "l'arête hors table est comptée sous son nom"
    );
}
