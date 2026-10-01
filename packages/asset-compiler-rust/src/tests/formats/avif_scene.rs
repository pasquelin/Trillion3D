use super::*;

#[test]
fn avif_extension_source_bakes_real_texture_preview_and_keeps_material_identity() {
    let run = compile_golden_source(&golden_dir("avif").join("scene.gltf"), "avif-scene");
    assert_eq!(run.result["sourceTriangles"], 1);
    assert!(
        !run.previews.is_empty(),
        "AVIF extension image must be baked, not omitted"
    );
    assert_eq!(run.result["texturePreviews"]["previews"], 1);
    let output = run
        .cache
        .join("native/full")
        .join(run.result["key"].as_str().unwrap());
    let tables = read_json(&output.join("scene-tables.json"));
    assert_eq!(tables["materials"][0]["name"], "AVIF alpha");
    assert_eq!(tables["materials"][0]["map"]["texture"], 0);
    assert_eq!(tables["textures"][0]["image"], 0);
    assert_eq!(
        tables["documents"]["source.gltf"]["images"][0]["mimeType"],
        "image/avif"
    );
}
