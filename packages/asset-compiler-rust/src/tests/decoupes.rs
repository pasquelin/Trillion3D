//! Complete cutout pipeline: scene with foliage declared in blend, answer
//! sheet compiler produces, and what answer changes in product.
//!
//! Texture written here in PNG rather than committed: shape tested,
//! reading in code expresses measured property better than binary file.
use super::*;

/// Leaf: full disc with 3-pixel softened edge, empty background.
fn feuille_png() -> Vec<u8> {
    let image = image::RgbaImage::from_fn(64, 64, |x, y| {
        let (dx, dy) = (x as f32 - 31.5, y as f32 - 31.5);
        let rayon = (dx * dx + dy * dy).sqrt();
        let part = ((21.0 - rayon) / 3.0).clamp(0.0, 1.0);
        image::Rgba([40, 120, 40, (part * 255.0).round() as u8])
    });
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("png");
    png
}

/// Textured quad with material declared in blend, ready to compile.
fn scene_feuillage() -> (PathBuf, Options) {
    let (root, mut options) = cube_fixture();
    let source = options.source.clone();
    fs::write(source.join("feuille.png"), feuille_png()).expect("texture");
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
        serde_json::to_vec(&manifest).expect("manifeste"),
    )
    .expect("manifeste");
    options.scope = "full".into();
    (root, options)
}

fn feuille_de_reponses(options: &Options) -> Value {
    read_json(&options.cache.join(crate::cutout::DECISIONS_FILE))
}

// Behavior: each compiled model gets answer sheet, whether items to decide
// or not. Sheet carries measurement and proposal, answer null:
// until decided, blend remains blend.
#[test]
fn chaque_modele_repart_avec_sa_feuille() {
    let (_root, options) = scene_feuillage();
    let result = compile(&options, |_| {}).expect("compile");
    let sheet = feuille_de_reponses(&options);
    let (_, entry) = sheet["textures"]
        .as_object()
        .expect("textures")
        .iter()
        .next()
        .expect("une");
    assert_eq!(
        entry["proposal"],
        json!("cutout"),
        "the sheet is proposed as cutout"
    );
    assert_eq!(entry["cutout"], Value::Null, "nobody has decided yet");
    assert_eq!(entry["image"], json!("feuille.png"));
    assert_eq!(result["primitives"][0]["pass"], json!("clustered-blend"));
    assert_eq!(result["cutouts"]["pending"], json!(1));
    assert_eq!(
        result["cutouts"]["version"],
        json!(crate::cutout::SHEET_VERSION)
    );
}

// Behavior: answer in sheet sets foliage to mask at glTF threshold,
// primitive leaves blend path for exact clusters — single draw call
// instead of per-item call. Published `source.gltf` carries reclassified material.
// c'est lui que le moteur lit pour ombrer.
#[test]
fn une_reponse_enregistree_fait_passer_le_feuillage_en_decoupe() {
    let (_root, options) = scene_feuillage();
    let first = compile(&options, |_| {}).expect("first compile");
    let mut sheet = feuille_de_reponses(&options);
    for (_, entry) in sheet["textures"]
        .as_object_mut()
        .expect("textures")
        .iter_mut()
    {
        entry["cutout"] = json!(true);
    }
    fs::write(
        options.cache.join(crate::cutout::DECISIONS_FILE),
        serde_json::to_vec(&sheet).expect("feuille"),
    )
    .expect("write");
    let second = compile(&options, |_| {}).expect("seconde compile");
    assert_eq!(second["primitives"][0]["pass"], json!("exact-clusters"));
    assert_eq!(
        second["cutouts"]["changes"]["applied"][0]["material"],
        json!(0)
    );
    assert_ne!(
        first["key"], second["key"],
        "an answer changes the product identity"
    );
    let published = read_json(
        &options
            .cache
            .join("native")
            .join("full")
            .join(second["key"].as_str().expect("key"))
            .join("source.gltf"),
    );
    assert_eq!(published["materials"][0]["alphaMode"], json!("MASK"));
    assert_eq!(published["materials"][0]["alphaCutoff"], json!(0.5));
}
