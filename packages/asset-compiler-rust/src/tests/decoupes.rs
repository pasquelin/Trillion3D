//! Le chemin complet des découpes : une scène dont le feuillage est déclaré en mélange, la feuille
//! de réponses que le compilateur en tire, puis ce que la réponse change au produit.
//!
//! La texture est écrite ici, en PNG, plutôt que déposée dans le dépôt : sa forme est ce que le
//! test éprouve, et la lire dans le code dit mieux ce qui est mesuré qu'un fichier binaire.
use super::*;

/// Une feuille : un disque plein au bord adouci sur trois pixels, sur fond entièrement vide.
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

/// Un quadrilatère texturé par un matériau déclaré en mélange, prêt à compiler.
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

// Comportement : chaque modèle compilé repart avec sa feuille de réponses et sa page, qu'il y ait
// ou non quelque chose à trancher. La feuille porte la mesure et la proposition, et la réponse y
// est nulle : tant que personne n'a tranché, le mélange reste du mélange.
#[test]
fn chaque_modele_repart_avec_sa_feuille_et_sa_page() {
    let (_root, options) = scene_feuillage();
    let result = compile(&options, |_| {}).expect("compile");
    let sheet = feuille_de_reponses(&options);
    let (sha, entry) = sheet["textures"]
        .as_object()
        .expect("textures")
        .iter()
        .next()
        .expect("une");
    assert_eq!(
        entry["proposal"],
        json!("cutout"),
        "la feuille est proposée en découpe"
    );
    assert_eq!(entry["cutout"], Value::Null, "personne n'a encore tranché");
    assert_eq!(entry["image"], json!("feuille.png"));
    assert_eq!(result["primitives"][0]["pass"], json!("clustered-blend"));
    assert_eq!(result["cutouts"]["pending"], json!(1));
    assert_eq!(
        result["cutouts"]["version"],
        json!(crate::cutout::SHEET_VERSION)
    );
    let page = fs::read_to_string(options.cache.join(crate::cutout::PAGE_FILE)).expect("page");
    assert!(page.contains(sha), "la page nomme la texture à trancher");
    assert!(
        page.contains("\"pixels\":\""),
        "la page emporte ses vignettes"
    );
}

// Comportement : la réponse enregistrée depuis la page passe le feuillage en masqué au seuil de
// glTF, et la primitive quitte le chemin du mélange pour celui des grappes exactes — un seul appel
// de dessin au lieu d'un par item. Le `source.gltf` publié porte le matériau reclassé, puisque
// c'est lui que le moteur lit pour ombrer.
#[test]
fn une_reponse_enregistree_fait_passer_le_feuillage_en_decoupe() {
    let (_root, options) = scene_feuillage();
    let first = compile(&options, |_| {}).expect("première compile");
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
    .expect("écriture");
    let second = compile(&options, |_| {}).expect("seconde compile");
    assert_eq!(second["primitives"][0]["pass"], json!("exact-clusters"));
    assert_eq!(
        second["cutouts"]["changes"]["applied"][0]["material"],
        json!(0)
    );
    assert_ne!(
        first["key"], second["key"],
        "une réponse change l'identité du produit"
    );
    let published = read_json(
        &options
            .cache
            .join("native")
            .join("full")
            .join(second["key"].as_str().expect("clé"))
            .join("source.gltf"),
    );
    assert_eq!(published["materials"][0]["alphaMode"], json!("MASK"));
    assert_eq!(published["materials"][0]["alphaCutoff"], json!(0.5));
}
