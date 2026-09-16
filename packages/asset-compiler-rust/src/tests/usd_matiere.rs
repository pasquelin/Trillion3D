//! Ce qu'un `UsdPreviewSurface` texturé donne en glTF : l'opacité qui arrive par une image, et la
//! carte métal/rugosité que glTF range dans deux canaux d'une seule texture.
//!
//! Chaque cas est une couche minuscule écrite ici, à côté d'une vraie image : une texture qui ne se
//! lit pas ne prouverait rien de ce qui suit sa résolution.
use super::*;
use usd_driver::{temp_dir, wrap};

/// Le rapport d'une couche : les raisons nommées et leur compte.
fn unsupported(run: &GoldenRun) -> Value {
    run.prepared("usd").0["unsupported"].clone()
}

/// Le `pbrMetallicRoughness` du seul matériau de la couche.
fn pbr(gltf: &Value) -> Value {
    gltf["materials"][0]["pbrMetallicRoughness"].clone()
}

/// Une couche à un quad lié au matériau `M`, dont le `UsdPreviewSurface` porte `inputs` et dont les
/// nœuds de texture suivent.
fn layer(inputs: &str, shaders: &str) -> String {
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

/// Un `UsdUVTexture` nommé, sur une image du dossier de la couche.
fn texture(name: &str, file: &str) -> String {
    format!(
        r#"
        def Shader "{name}"
        {{
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @./textures/{file}@
            float outputs:a
            float outputs:b
            float outputs:g
            float outputs:r
            float3 outputs:rgb
        }}
"#
    )
}

/// Écrit la couche et les images qu'elle cite, puis compile par le harnais commun.
fn compile(tag: &str, body: &str, files: &[&str]) -> GoldenRun {
    let dir = temp_dir(tag);
    fs::create_dir_all(dir.join("textures")).expect("dossier des textures");
    let image = golden_dir("usd")
        .join("minuscule")
        .join("textures")
        .join("checker.png");
    for file in files {
        fs::copy(&image, dir.join("textures").join(file)).expect("image");
    }
    let source = dir.join("scene.usda");
    fs::write(&source, body).expect("couche");
    let run = compile_golden_source(&source, tag);
    fs::remove_dir_all(&dir).ok();
    run
}

// Comportement 46 : une opacité branchée sur l'alpha de la texture de couleur de base arrive dans
// la scène — une entrée connectée l'emporte sur la valeur écrite, donc le facteur d'alpha vaut un
// et laisse passer l'image, et le mode suit la sémantique de USD : mélange, ou découpe quand
// `opacityThreshold` la demande.
#[test]
fn an_opacity_bound_to_the_base_colour_texture_reaches_the_alpha_and_the_blend_mode() {
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>\n            float inputs:opacity = 0.25\n            float inputs:opacity.connect = </Root/M/T.outputs:a>";
    let run = compile(
        "opacite",
        &layer(inputs, &texture("T", "checker.png")),
        &["checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(gltf["materials"][0]["alphaMode"], "BLEND");
    assert_eq!(
        pbr(&gltf)["baseColorFactor"],
        json!([1.0, 1.0, 1.0, 1.0]),
        "le facteur ne doit pas rendre l'image opaque"
    );
    assert_eq!(pbr(&gltf)["baseColorTexture"]["index"], 0);
    assert_eq!(
        gltf["textures"].as_array().map(Vec::len),
        Some(1),
        "aucune texture orpheline"
    );
    let cut = format!("{inputs}\n            float inputs:opacityThreshold = 0.5");
    let run = compile(
        "decoupe",
        &layer(&cut, &texture("T", "checker.png")),
        &["checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(gltf["materials"][0]["alphaMode"], "MASK");
    assert_eq!(gltf["materials"][0]["alphaCutoff"], 0.5);
}

// Comportement 47 : une opacité portée par une **autre** image que la couleur de base ne se range
// pas dans l'alpha de glTF sans recomposer des octets. Elle est comptée par son nom, et rien n'est
// versé de l'image qu'on ne sait pas brancher.
#[test]
fn an_opacity_carried_by_a_second_image_is_counted_rather_than_loaded_and_dropped() {
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>\n            float inputs:opacity.connect = </Root/M/U.outputs:a>";
    let shaders = format!(
        "{}{}",
        texture("T", "checker.png"),
        texture("U", "autre.png")
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
        "l'image d'opacité n'est pas versée pour être jetée"
    );
    assert_eq!(
        gltf["materials"][0]["alphaMode"], "OPAQUE",
        "la transparence non portée n'est pas annoncée"
    );
}
