//! Ce qu'un nuanceur de Maya porte autour de ses images : le poids scalaire d'une couleur, le mode
//! d'un `bump2d`, et le placage d'un `place2dTexture`.
use super::*;
use ma_driver::{compile_ma, shaded};

/// Le nœud `file` de la scène et le `place2dTexture` qui lui donne ses coordonnées.
fn image(place: &str) -> String {
    format!(
        "createNode file -n \"Image\";\n\
         \tsetAttr \".ftn\" -type \"string\" \"textures/checker.png\";\n\
         createNode place2dTexture -n \"Placage\";\n{place}\
         connectAttr \"Placage.o\" \"Image.uv\";\n"
    )
}

/// Le matériau glTF de ce nom dans une scène intermédiaire.
fn material<'a>(gltf: &'a Value, name: &str) -> &'a Value {
    gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .find(|material| material["name"] == json!(name))
        .unwrap_or_else(|| panic!("aucun matériau nommé {name}"))
}

// Constat 20 : un `bump2d` n'est une carte de normales que lorsque `bumpInterp` le dit. Pris pour
// tel quel qu'il soit, un relief en hauteur sortait en `normalTexture`, ce qui éclaire la surface
// par une image qui n'en décrit pas l'orientation. Seul le mode tangent passe, `bumpDepth` portant
// son échelle ; les deux autres sont comptés par leur nom.
#[test]
fn only_a_tangent_space_bump_becomes_a_normal_texture() {
    let bump = |name: &str, interp: &str| {
        format!(
            "createNode bump2d -n \"{name}Bosse\";\n{interp}\
             createNode lambert -n \"{name}\";\n\
             connectAttr \"Image.oc\" \"{name}Bosse.bv\";\n\
             connectAttr \"{name}Bosse.o\" \"{name}.n\";\n"
        )
    };
    let body = format!(
        "{}{}{}{}{}{}{}",
        image(""),
        bump("Hauteur", ""),
        bump("Tangente", "\tsetAttr \".bi\" 1;\n\tsetAttr \".bd\" 0.4;\n"),
        bump("Objet", "\tsetAttr \".bi\" 2;\n"),
        shaded("A", "Hauteur"),
        shaded("B", "Tangente"),
        shaded("C", "Objet"),
    );
    let (manifest, gltf) = compile_ma("ma-bump", &body).prepared("ma");
    assert!(
        material(&gltf, "Hauteur").get("normalTexture").is_none(),
        "un relief en hauteur n'est pas une carte de normales"
    );
    assert!(material(&gltf, "Objet").get("normalTexture").is_none());
    let tangent = &material(&gltf, "Tangente")["normalTexture"];
    assert!(tangent["index"].is_number(), "{tangent}");
    assert_eq!(tangent["scale"], json!(0.4), "`bumpDepth` porte l'échelle");
    assert_eq!(manifest["unsupported"]["ma-bump-height-unsupported"], 1);
    assert_eq!(
        manifest["unsupported"]["ma-bump-object-space-unsupported"],
        1
    );
}
