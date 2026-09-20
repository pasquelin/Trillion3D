//! Default values of `UsdPreviewSurface`, and what base glTF lacks to carry rest.
//!
//! Specification gives these values; ignoring makes surface brighter, smoother
//! or more opaque than layer describes.
use super::*;
use usd_driver::compile_layer;
use usd_matiere::{compile, layer, pbr, texture, unsupported};

/// Single material of layer.
fn material(gltf: &Value) -> Value {
    gltf["materials"][0].clone()
}

// Behavior 55: `UsdPreviewSurface` writing nothing equals specification —
// `diffuseColor` 0.18, `metallic` 0, `roughness` 0.5, `opacity` 1 — not white.
#[test]
fn a_preview_surface_that_writes_nothing_carries_the_values_of_the_specification() {
    let (_, gltf) = compile_layer("defauts", &layer("", "")).prepared("usd");
    assert_eq!(
        pbr(&gltf)["baseColorFactor"],
        json!([0.18, 0.18, 0.18, 1.0]),
        "the implicit diffuse colour of UsdPreviewSurface is 0.18"
    );
    assert_eq!(pbr(&gltf)["metallicFactor"], 0.0);
    assert_eq!(pbr(&gltf)["roughnessFactor"], 0.5);
}

// Behavior 56: textured occlusion arrives in `occlusionTexture`, glTF reads in
// red channel; plugged into another channel, carried as is, discrepancy counted.
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
        "the map stays carried, the channel is stated"
    );
}

// Behavior 57: `UsdPreviewSurface` declaration base glTF lacks — specular
// workflow, clearcoat, IOR, written non-textured normal — counted
// by name rather than lost silently.
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
        "the report of what glTF does not carry has moved"
    );

    let defaults = r#"            int inputs:useSpecularWorkflow = 0
            float inputs:clearcoat = 0
            float inputs:ior = 1.5
            normal3f inputs:normal = (0, 0, 1)"#;
    let run = compile_layer("hors-gltf-defauts", &layer(defaults, ""));
    assert_eq!(
        unsupported(&run),
        json!({}),
        "a value written at its default is not a gap"
    );
}
