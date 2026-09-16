//! Ce que les arêtes d'un maillage Maya disent de son lissage. Maya n'écrit pas de groupe de
//! lissage : c'est le drapeau de dureté de chaque arête, le troisième nombre de `.ed`, qui dit où
//! la continuité se coupe — et `.n`, quand le fichier l'écrit, qui décide à sa place.
use super::*;
use ma_driver::{close, compile_ma, normals};

/// La pente d'un versant du toit, de longueur un.
const LEFT: [f32; 3] = [
    -std::f32::consts::FRAC_1_SQRT_2,
    0.0,
    std::f32::consts::FRAC_1_SQRT_2,
];
const RIGHT: [f32; 3] = [
    std::f32::consts::FRAC_1_SQRT_2,
    0.0,
    std::f32::consts::FRAC_1_SQRT_2,
];

/// Un toit de deux quadrilatères partageant l'arête de faîte, `.ed[1]`, dure ou douce. Les deux
/// versants ont la même aire : leur moyenne au faîte est donc exactement verticale.
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

// Constat 22 : les arêtes lisses et dures d'un maillage Maya étaient perdues, toutes les normales
// calculées à plat. Une arête douce continue désormais le lissage d'une face à l'autre, et les
// sommets qui la portent ne sont plus écrits deux fois.
#[test]
fn a_soft_edge_carries_the_shading_from_one_face_to_the_next() {
    let run = compile_ma("ma-arete-douce", &roof(0));
    let (manifest, gltf) = run.prepared("ma");
    let part = &gltf["meshes"][0]["primitives"][0];
    let written = normals(&run, &gltf, part);
    assert_eq!(
        written.len(),
        6,
        "six sommets : le faîte n'est plus écrit deux fois"
    );
    for rank in [1, 2] {
        assert!(
            close(written[rank], [0.0, 0.0, 1.0]),
            "le faîte moyenne les deux versants : {written:?}"
        );
    }
    assert!(close(written[0], LEFT), "{written:?}");
    assert!(close(written[4], RIGHT), "{written:?}");
    assert_eq!(manifest["unsupported"]["ma-normals-computed"], 1);
}

// Constat 22, l'autre bout : le troisième nombre de `.ed` marque une arête dure. Le faîte du toit
// garde alors la pente de son propre versant de chaque côté, et le sommet est écrit deux fois —
// une arête vive ne s'arrondit pas.
#[test]
fn a_hard_edge_splits_the_shading_of_the_two_faces_it_separates() {
    let run = compile_ma("ma-arete-dure", &roof(1));
    let (_, gltf) = run.prepared("ma");
    let part = &gltf["meshes"][0]["primitives"][0];
    let written = normals(&run, &gltf, part);
    assert_eq!(
        written.len(),
        8,
        "le faîte est coupé : deux sommets de plus"
    );
    for rank in 0..4 {
        assert!(close(written[rank], LEFT), "{written:?}");
        assert!(close(written[rank + 4], RIGHT), "{written:?}");
    }
}
