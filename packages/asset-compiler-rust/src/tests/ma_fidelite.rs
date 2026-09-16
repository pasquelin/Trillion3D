//! Ce que le fichier Maya ASCII dit de sa scène et que le pilote doit rendre tel quel : deux nœuds
//! homonymes sous deux pères, les faces qu'aucun ensemble ne réclame, et les formes que Maya ne
//! dessine jamais.
//!
//! La pose d'un `transform` a son propre fichier, `ma_xform.rs` ; la scène dorée est dans
//! `ma_golden.rs`.
use super::*;
use ma_driver::{compile_ma, quad, translations};

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
