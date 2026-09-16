//! Ce qu'un prim tient de ses ancêtres : le matériau que `material:binding` lie plus haut, et le
//! `doubleSided` que la géométrie déclare sans qu'aucun matériau ne soit lié.
//!
//! Les textures ont leur propre fichier, `usd_textures.rs` ; les faces invalides `usd_faces.rs`.
use super::*;
use usd_driver::{compile_layer, wrap};

/// Deux matériaux nommés, de quoi distinguer celui qui gagne.
pub(super) const PAIR: &str = r#"
    def Material "M"
    {
        token outputs:surface.connect = </Root/M/S.outputs:surface>

        def Shader "S"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (1, 0, 0)
            token outputs:surface
        }
    }

    def Material "N"
    {
        token outputs:surface.connect = </Root/N/S.outputs:surface>

        def Shader "S"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (0, 1, 0)
            token outputs:surface
        }
    }
"#;

/// Le nom du matériau de chaque primitive du maillage de ce rang, ou `null` quand elle n'en cite pas.
pub(super) fn bound(gltf: &Value, mesh: usize) -> Vec<Value> {
    gltf["meshes"][mesh]["primitives"]
        .as_array()
        .expect("primitives")
        .iter()
        .map(|primitive| match primitive["material"].as_u64() {
            Some(rank) => gltf["materials"][rank as usize]["name"].clone(),
            None => Value::Null,
        })
        .collect()
}

/// Un maillage carré à deux faces, nommé, qui porte `extra` entre ses attributs.
pub(super) fn quad(name: &str, extra: &str) -> String {
    format!(
        r#"
    def Mesh "{name}"
    {{
        int[] faceVertexCounts = [4, 4]
        int[] faceVertexIndices = [0, 1, 2, 3, 3, 2, 4, 5]
        point3f[] points = [(0,0,0), (1,0,0), (1,1,0), (0,1,0), (1,2,0), (0,2,0)]
        uniform token subdivisionScheme = "none"
{extra}    }}
"#
    )
}

// Comportement 50 : `material:binding` se résout en remontant les ancêtres — la liaison la plus
// proche gagne, un `GeomSubset` sans liaison prend celle de son maillage, et une liaison déclarée
// `strongerThanDescendants` l'emporte sur celles de sa descendance.
#[test]
fn a_material_bound_on_an_ancestor_reaches_the_prims_that_do_not_bind_one() {
    let body = format!(
        "    rel material:binding = </Root/M>\n{}{PAIR}",
        quad("Quad", "")
    );
    let (_, gltf) = compile_layer("heritage", &wrap("", &body)).prepared("usd");
    assert_eq!(
        bound(&gltf, 0),
        ["M"],
        "la liaison de l'ancêtre atteint le maillage"
    );

    let subset = r#"
        def GeomSubset "Haut"
        {
            uniform token elementType = "face"
            uniform token familyName = "materialBind"
            int[] indices = [1]
        }
"#;
    let body = format!(
        "    rel material:binding = </Root/M>\n{}{PAIR}",
        quad("Quad", subset)
    );
    let (_, gltf) = compile_layer("heritage-subset", &wrap("", &body)).prepared("usd");
    assert_eq!(
        bound(&gltf, 0),
        ["M", "M"],
        "le sous-ensemble sans liaison prend celle de son maillage"
    );

    let strong = "    rel material:binding = </Root/M> (\n        bindMaterialAs = \"strongerThanDescendants\"\n    )\n";
    let body = format!(
        "{strong}{}{PAIR}",
        quad("Quad", "        rel material:binding = </Root/N>\n")
    );
    let (_, gltf) = compile_layer("heritage-fort", &wrap("", &body)).prepared("usd");
    assert_eq!(
        bound(&gltf, 0),
        ["M"],
        "la liaison plus forte que sa descendance l'emporte"
    );
}

// Comportement 51 : `doubleSided` est une propriété de la géométrie en USD et du matériau en glTF.
// Un maillage double face sans matériau lié en reçoit un, partagé par tous ceux qui sont dans son
// cas ; un maillage lié, lui, obtient une variante double face de son matériau, jamais une mutation
// de celui que les autres maillages citent.
#[test]
fn a_double_sided_mesh_without_a_binding_still_carries_its_two_faces() {
    let body = quad("Quad", "        uniform bool doubleSided = 1\n");
    let (_, gltf) = compile_layer("double-seul", &wrap("", &body)).prepared("usd");
    let materials = gltf["materials"].as_array().expect("materials").clone();
    assert_eq!(materials.len(), 1, "un seul matériau par défaut");
    assert_eq!(
        materials[0]["doubleSided"],
        json!(true),
        "le double face du maillage arrive au matériau"
    );
    assert_eq!(bound(&gltf, 0), [materials[0]["name"].clone()]);

    let body = format!(
        "    rel material:binding = </Root/M>\n{}{}{PAIR}",
        quad("Simple", ""),
        quad("Face", "        uniform bool doubleSided = 1\n")
    );
    let (_, gltf) = compile_layer("double-variante", &wrap("", &body)).prepared("usd");
    let sides: Vec<Value> = gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .map(|material| material["doubleSided"].clone())
        .collect();
    assert_eq!(
        sides,
        [Value::Null, json!(true)],
        "le matériau partagé reste simple face, sa variante porte les deux"
    );
    assert_eq!(
        bound(&gltf, 0),
        ["M"],
        "le maillage simple face garde le sien"
    );
}
