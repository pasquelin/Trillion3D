//! A material keeps the blend mode its source authored: no texture's alpha reclassifies it.
//!
//! Texture written here in PNG rather than committed: shape tested,
//! reading in code expresses measured property better than binary file.
use super::*;
use crate::tests::textures::previews_source::encode;
use trillion3d_math::scalar::unit_to_byte_f32;

/// Leaf: full disc with 3-pixel softened edge, empty background.
fn sheet_png() -> Vec<u8> {
    encode(image::RgbaImage::from_fn(64, 64, |x, y| {
        let (dx, dy) = (x as f32 - 31.5, y as f32 - 31.5);
        let rayon = (dx * dx + dy * dy).sqrt();
        image::Rgba([40, 120, 40, unit_to_byte_f32((21.0 - rayon) / 3.0)])
    }))
}

/// Textured quad with material declared in blend, ready to compile.
fn scene_feuillage() -> (PathBuf, Options) {
    let (root, mut options) = cube_fixture();
    let source = options.source.clone();
    fs::write(source.join("feuille.png"), sheet_png()).expect("texture");
    let mut gltf = read_json(&source.join("cube.gltf"));
    gltf["materials"] = json!([{"alphaMode":"BLEND","name":"feuillage",
        "pbrMetallicRoughness":{"baseColorTexture":{"index":0}}}]);
    gltf["textures"] = json!([{ "source": 0 }]);
    gltf["images"] = json!([{ "uri": "feuille.png" }]);
    gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    let bytes = serde_json::to_vec(&gltf).expect("gltf");
    fs::write(source.join("cube.gltf"), &bytes).expect("gltf");
    let mut manifest = read_json(&source.join("manifest.json"));
    manifest["runtime"]["sha256"] = json!(hash(&bytes));
    fs::write(
        source.join("manifest.json"),
        serde_json::to_vec(&manifest).expect("manifest"),
    )
    .expect("manifest");
    options.scope = "full".into();
    (root, options)
}

// Behavior: a leaf declared in blend whose texture is present or absent at every texel stays
// blend — its primitive takes the blend path, the published `source.gltf` carries the material
// as authored, with no cutoff added: the blend mode is the source's, never measured.
#[test]
fn foliage_authored_in_blend_stays_blend() {
    let (_root, options) = scene_feuillage();
    let result = compile(&options, |_| {}).expect("compile");
    let published = read_json(
        &options
            .cache
            .join("native")
            .join("full")
            .join(result["key"].as_str().expect("key"))
            .join("source.gltf"),
    );
    assert_eq!(published["materials"][0]["alphaMode"], json!("BLEND"));
    assert!(published["materials"][0].get("alphaCutoff").is_none());
    assert_eq!(result["primitives"][0]["pass"], json!("clustered-blend"));
}
