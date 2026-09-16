//! Les valeurs par défaut d'un `UsdPreviewSurface`, et ce que glTF n'a pas pour porter le reste.
//!
//! La spécification donne ces valeurs ; les ignorer rend une surface plus claire, plus lisse ou
//! plus opaque que la couche ne la décrit.
use super::*;
use usd_driver::compile_layer;
use usd_matiere::{compile, layer, pbr, texture, unsupported};

/// Le matériau unique de la couche.
fn material(gltf: &Value) -> Value {
    gltf["materials"][0].clone()
}

// Comportement 55 : un `UsdPreviewSurface` qui n'écrit rien vaut ce que la spécification dit —
// `diffuseColor` 0,18, `metallic` 0, `roughness` 0,5, `opacity` 1 — et non le blanc.
#[test]
fn a_preview_surface_that_writes_nothing_carries_the_values_of_the_specification() {
    let (_, gltf) = compile_layer("defauts", &layer("", "")).prepared("usd");
    assert_eq!(
        pbr(&gltf)["baseColorFactor"],
        json!([0.18, 0.18, 0.18, 1.0]),
        "la couleur diffuse implicite de UsdPreviewSurface est 0,18"
    );
    assert_eq!(pbr(&gltf)["metallicFactor"], 0.0);
    assert_eq!(pbr(&gltf)["roughnessFactor"], 0.5);
}

// Comportement 56 : une occlusion texturée arrive dans `occlusionTexture`, que glTF lit dans le
// canal rouge ; branchée sur un autre canal, elle est portée telle quelle et l'écart est compté.
#[test]
fn a_textured_occlusion_reaches_the_occlusion_texture_through_its_red_channel() {
    let inputs = "            float inputs:occlusion.connect = </Root/M/T.outputs:r>";
    let run = compile(
        "occlusion",
        &layer(inputs, &texture("T", "checker.png", "")),
        &["checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(material(&gltf)["occlusionTexture"]["index"], 0);
    assert_eq!(
        unsupported(&run)["usd-texture-channel-unsupported"],
        Value::Null
    );

    let other = "            float inputs:occlusion.connect = </Root/M/T.outputs:g>";
    let run = compile(
        "occlusion-canal",
        &layer(other, &texture("T", "checker.png", "")),
        &["checker.png"],
    );
    assert_eq!(unsupported(&run)["usd-texture-channel-unsupported"], 1);
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        material(&gltf)["occlusionTexture"]["index"],
        0,
        "la carte reste portée, le canal est dit"
    );
}

// Comportement 57 : ce qu'un `UsdPreviewSurface` déclare et que le glTF de base n'a pas — flux de
// travail spéculaire, vernis, indice de réfraction, normale écrite plutôt que texturée — est compté
// par son nom plutôt que perdu en silence.
#[test]
fn what_gltf_has_no_place_for_in_a_preview_surface_is_counted_by_its_name() {
    let inputs = r#"            int inputs:useSpecularWorkflow = 1
            color3f inputs:specularColor = (0.4, 0.4, 0.4)
            float inputs:clearcoat = 0.4
            float inputs:clearcoatRoughness = 0.2
            float inputs:ior = 1.8
            normal3f inputs:normal = (0, 1, 0)"#;
    let run = compile_layer("hors-gltf", &layer(inputs, ""));
    assert_eq!(
        unsupported(&run),
        json!({
            "usd-specular-workflow-unsupported": 1,
            "usd-clearcoat-unsupported": 1,
            "usd-ior-unsupported": 1,
            "usd-normal-value-unsupported": 1,
        }),
        "le rapport de ce que glTF ne porte pas a bougé"
    );

    let defaults = r#"            int inputs:useSpecularWorkflow = 0
            float inputs:clearcoat = 0
            float inputs:ior = 1.5
            normal3f inputs:normal = (0, 0, 1)"#;
    let run = compile_layer("hors-gltf-defauts", &layer(defaults, ""));
    assert_eq!(
        unsupported(&run),
        json!({}),
        "une valeur écrite à son défaut n'est pas un écart"
    );
}
