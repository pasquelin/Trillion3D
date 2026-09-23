//! What `UsdUVTexture` declares around file: resolution root file
//! resolves against, axis repetition, and `scale`, `bias`, `sourceColorSpace`.
//! deviennent en glTF.
use super::material::{layer, pbr, texture, unsupported};
use super::*;

/// Writes temporary tree — layers and cited images, each at
/// path under root — then compiles `scene.usda` via common harness.
pub(in crate::tests) fn compile_files(
    tag: &str,
    layers: &[(&str, &str)],
    images: &[&str],
) -> GoldenRun {
    let dir = super::driver::temp_dir(tag);
    let checker = golden_dir("usd")
        .join("minuscule")
        .join("textures")
        .join("checker.png");
    for (name, body) in layers {
        write_under(&dir, name, |path| fs::write(path, body).map(|_| ()));
    }
    for file in images {
        write_under(&dir, file, |path| fs::copy(&checker, path).map(|_| ()));
    }
    let run = compile_golden_source(&dir.join("scene.usda"), tag);
    fs::remove_dir_all(&dir).ok();
    run
}

/// Places file under temporary root, creating folders first.
fn write_under(root: &Path, name: &str, put: impl FnOnce(&Path) -> std::io::Result<()>) {
    let path = root.join(name);
    fs::create_dir_all(path.parent().expect("dir")).expect("dir");
    put(&path).unwrap_or_else(|error| panic!("{name}: {error}"));
}

/// Sampler of scene single texture.
fn sampler(gltf: &Value) -> Value {
    let rank = gltf["textures"][0]["sampler"].as_u64().expect("sampler");
    gltf["samplers"][rank as usize].clone()
}

// Behavior 53: asset path anchors on folder of writing layer, not
// root layer: reference in subfolder finds images.
#[test]
fn a_texture_of_a_referenced_layer_resolves_against_the_directory_of_that_layer() {
    let root = "#usda 1.0\n(\n    defaultPrim = \"Root\"\n)\n\ndef Xform \"Root\" (\n    prepend references = @./sous/piece.usda@</Root>\n)\n{\n}\n";
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>";
    let piece = layer(inputs, &texture("T", "checker.png", ""));
    let run = compile_files(
        "couche-referencee",
        &[("scene.usda", root), ("sous/piece.usda", &piece)],
        &["sous/textures/checker.png"],
    );
    assert_eq!(
        unsupported(&run)["usd-texture-missing"],
        Value::Null,
        "the referenced layer's texture is found"
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        gltf["images"][0]["uri"], "sous/textures/checker.png",
        "the URI stays relative to the image root"
    );
}

// Behavior 54: `wrapS` and `wrapT` two axes, never single; unsupported mode
// repeats and counts; uniform `scale` without `bias` enters glTF factor, rest —
// non-reducible `scale`, color space opposing entry role — counted.
#[test]
fn the_wrap_scale_bias_and_colour_space_of_a_uv_texture_are_carried_or_counted() {
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>";
    let axes =
        "            token inputs:wrapS = \"repeat\"\n            token inputs:wrapT = \"clamp\"\n";
    let run = compile_files(
        "axes",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", axes)),
        )],
        &["textures/checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        [&sampler(&gltf)["wrapS"], &sampler(&gltf)["wrapT"]],
        [&json!(10497), &json!(33071)],
        "each axis keeps its own mode"
    );

    let black = "            token inputs:wrapT = \"black\"\n";
    let run = compile_files(
        "bord-noir",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", black)),
        )],
        &["textures/checker.png"],
    );
    assert_eq!(unsupported(&run)["usd-texture-wrap-unsupported"], 1);

    let scale = "            float4 inputs:scale = (0.5, 0.5, 0.5, 1)\n";
    let run = compile_files(
        "echelle",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", scale)),
        )],
        &["textures/checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        pbr(&gltf)["baseColorFactor"],
        json!([0.5, 0.5, 0.5, 1.0]),
        "a uniform scale without bias is carried by the factor"
    );

    let tilted = "            float4 inputs:scale = (0.5, 1, 1, 1)\n            float4 inputs:bias = (0.1, 0, 0, 0)\n";
    let run = compile_files(
        "echelle-biaisee",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", tilted)),
        )],
        &["textures/checker.png"],
    );
    assert_eq!(unsupported(&run)["usd-texture-scale-unsupported"], 1);
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        pbr(&gltf)["baseColorFactor"],
        json!([1.0, 1.0, 1.0, 1.0]),
        "what the factor does not carry is not invented"
    );

    let raw = "            token inputs:sourceColorSpace = \"raw\"\n";
    let run = compile_files(
        "espace",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", raw)),
        )],
        &["textures/checker.png"],
    );
    assert_eq!(unsupported(&run)["usd-texture-colour-space-unsupported"], 1);
}
