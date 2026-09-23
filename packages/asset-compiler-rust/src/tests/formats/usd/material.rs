//! What a textured `UsdPreviewSurface` yields in glTF: opacity that arrives
//! through an image, and the metal/roughness map glTF stores in two channels of
//! a single texture.
//!
//! Each case is a tiny layer written here, beside a real image: a texture that
//! cannot be read would prove nothing of what follows its resolution.
use super::driver::wrap;
use super::*;

/// Report of a layer: named reasons and their count.
pub(in crate::tests) fn unsupported(run: &GoldenRun) -> Value {
    run.prepared("usd").0["unsupported"].clone()
}

/// The `pbrMetallicRoughness` of the layer's only material.
pub(in crate::tests) fn pbr(gltf: &Value) -> Value {
    gltf["materials"][0]["pbrMetallicRoughness"].clone()
}

/// A layer with one quad bound to material `M`, whose `UsdPreviewSurface` carries
/// `inputs` and whose texture nodes follow.
pub(in crate::tests) fn layer(inputs: &str, shaders: &str) -> String {
    let body = format!(
        r#"    def Mesh "Quad" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {{
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        rel material:binding = </Root/M>
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        uniform token subdivisionScheme = "none"
    }}

    def Material "M"
    {{
        token outputs:surface.connect = </Root/M/S.outputs:surface>

        def Shader "S"
        {{
            uniform token info:id = "UsdPreviewSurface"
{inputs}
            token outputs:surface
        }}
{shaders}    }}"#
    );
    wrap("", &body)
}

/// A named `UsdUVTexture`, on an image of the layer's folder, which carries
/// `extra` among its inputs — a wrap mode, a scale, a colour space.
pub(in crate::tests) fn texture(name: &str, file: &str, extra: &str) -> String {
    format!(
        r#"
        def Shader "{name}"
        {{
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @./textures/{file}@
{extra}            float outputs:a
            float outputs:b
            float outputs:g
            float outputs:r
            float3 outputs:rgb
        }}
"#
    )
}

/// Writes the layer and the images it cites under `textures/`, then compiles with the common harness.
pub(in crate::tests) fn compile(tag: &str, body: &str, files: &[&str]) -> GoldenRun {
    let images: Vec<String> = files
        .iter()
        .map(|file| format!("textures/{file}"))
        .collect();
    let paths: Vec<&str> = images.iter().map(String::as_str).collect();
    super::textures::compile_files(tag, &[("scene.usda", body)], &paths)
}

// Behaviour 46: an opacity wired to the alpha of the base-colour texture reaches
// the scene — a connected input wins over the written value, so the alpha factor
// is one and lets the image through, and the mode follows USD semantics: blend,
// or cutout when `opacityThreshold` asks for it.
#[test]
fn an_opacity_bound_to_the_base_colour_texture_reaches_the_alpha_and_the_blend_mode() {
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>\n            float inputs:opacity = 0.25\n            float inputs:opacity.connect = </Root/M/T.outputs:a>";
    let run = compile(
        "opacite",
        &layer(inputs, &texture("T", "checker.png", "")),
        &["checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(gltf["materials"][0]["alphaMode"], "BLEND");
    assert_eq!(
        pbr(&gltf)["baseColorFactor"],
        json!([1.0, 1.0, 1.0, 1.0]),
        "the factor must not make the image opaque"
    );
    assert_eq!(pbr(&gltf)["baseColorTexture"]["index"], 0);
    assert_eq!(
        gltf["textures"].as_array().map(Vec::len),
        Some(1),
        "no orphan texture"
    );
    let cut = format!("{inputs}\n            float inputs:opacityThreshold = 0.5");
    let run = compile(
        "decoupe",
        &layer(&cut, &texture("T", "checker.png", "")),
        &["checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(gltf["materials"][0]["alphaMode"], "MASK");
    assert_eq!(gltf["materials"][0]["alphaCutoff"], 0.5);
}

// Behaviour 47: an opacity carried by an **other** image than the base colour
// does not fit in glTF's alpha without recomposing bytes. It is counted by name,
// and nothing is poured of the image we do not know how to wire.
#[test]
fn an_opacity_carried_by_a_second_image_is_counted_rather_than_loaded_and_dropped() {
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>\n            float inputs:opacity.connect = </Root/M/U.outputs:a>";
    let shaders = format!(
        "{}{}",
        texture("T", "checker.png", ""),
        texture("U", "autre.png", "")
    );
    let run = compile(
        "opacite-separee",
        &layer(inputs, &shaders),
        &["checker.png", "autre.png"],
    );
    assert_eq!(unsupported(&run)["usd-opacity-texture-unsupported"], 1);
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        gltf["images"].as_array().map(Vec::len),
        Some(1),
        "the opacity image is not poured to be thrown away"
    );
    assert_eq!(
        gltf["materials"][0]["alphaMode"], "OPAQUE",
        "uncarried transparency is not announced"
    );
}

// Behaviour 48: a shared metal/roughness map wins over the written factors —
// glTF multiplies the map by the factor, so it is one, otherwise metal would be cancelled.
#[test]
fn a_shared_metal_roughness_texture_wins_over_the_factors_instead_of_being_cancelled_by_them() {
    let inputs = "            float inputs:metallic.connect = </Root/M/T.outputs:b>\n            float inputs:roughness.connect = </Root/M/T.outputs:g>";
    let run = compile(
        "metal",
        &layer(inputs, &texture("T", "checker.png", "")),
        &["checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(pbr(&gltf)["metallicRoughnessTexture"]["index"], 0);
    assert_eq!(
        pbr(&gltf)["metallicFactor"],
        1.0,
        "the map carries the metal"
    );
    assert_eq!(pbr(&gltf)["roughnessFactor"], 1.0);
    assert_eq!(
        unsupported(&run)["usd-texture-channel-unsupported"],
        Value::Null
    );
}

// Behaviour 49: glTF reads metal in the blue channel of its map and roughness
// in the green; an input wired to another channel does not fit there, and that
// is counted by name.
#[test]
fn a_metal_roughness_input_bound_to_another_channel_is_counted_by_its_name() {
    let inputs = "            float inputs:metallic.connect = </Root/M/T.outputs:r>\n            float inputs:roughness.connect = </Root/M/T.outputs:g>";
    let run = compile(
        "canal",
        &layer(inputs, &texture("T", "checker.png", "")),
        &["checker.png"],
    );
    assert_eq!(unsupported(&run)["usd-texture-channel-unsupported"], 1);
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        pbr(&gltf)["metallicRoughnessTexture"]["index"],
        0,
        "the map stays carried, the channel is stated"
    );
}
