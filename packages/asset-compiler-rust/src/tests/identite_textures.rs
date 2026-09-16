//! A05 — Les images liées d'un glTF sont lues après le calcul de la clé : leurs pixels entrent dans
//! le produit — les aperçus de texture du sidecar — sans entrer dans l'identité qui le nomme. Un
//! PNG rouge remplacé par un PNG bleu laissait donc la clé intacte pendant que `clusters.bin`
//! changeait, et un consommateur qui réutilise par la clé gardait les aperçus d'avant.
use super::*;

/// Un PNG uni 8×8, dont la couleur distingue deux fichiers de même nom.
fn png(couleur: [u8; 4]) -> Vec<u8> {
    let image = image::RgbaImage::from_pixel(8, 8, image::Rgba(couleur));
    let mut bytes = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .expect("png");
    bytes
}

/// La fixture, dont le seul matériau porte une couleur de base liée à `color.png`.
fn source_texturee() -> (PathBuf, Options, PathBuf) {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["images"] = json!([{"uri":"color.png"}]);
    gltf["textures"] = json!([{"source":0}]);
    gltf["materials"] = json!([{"pbrMetallicRoughness":{"baseColorTexture":{"index":0}}}]);
    gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    write_gltf(&options, &gltf, None);
    let image = options.source.join("color.png");
    (root, options, image)
}

/// Compile et rend la clé exposée au consommateur avec l'empreinte du sidecar binaire écrit sous
/// elle : c'est ce couple qui doit bouger ensemble, ou pas du tout.
fn cle_et_sidecar(options: &Options) -> (String, String) {
    let result = compile(options, |_| {}).expect("compile");
    let key = result["key"].as_str().expect("clé").to_string();
    let sidecar = options
        .cache
        .join("native")
        .join(&options.scope)
        .join(&key)
        .join(MANIFEST_BINARY_FILE);
    let bytes = fs::read(sidecar).expect("sidecar binaire");
    (key, hash(&bytes))
}

// Comportement : une image liée qui change change la clé exposée ; la même image rend la même clé,
// et deux compilations identiques aussi.
#[test]
fn une_image_liee_modifiee_change_la_cle_exposee() {
    let (root, options, image) = source_texturee();
    fs::write(&image, png([255, 0, 0, 255])).expect("image rouge");
    let (cle_rouge, sidecar_rouge) = cle_et_sidecar(&options);
    let (cle_repetee, sidecar_repete) = cle_et_sidecar(&options);
    assert_eq!(
        (&cle_rouge, &sidecar_rouge),
        (&cle_repetee, &sidecar_repete),
        "deux compilations identiques rendent la même clé et le même sidecar"
    );

    fs::write(&image, png([0, 0, 255, 255])).expect("image bleue");
    let (cle_bleue, sidecar_bleu) = cle_et_sidecar(&options);
    assert_ne!(
        sidecar_rouge, sidecar_bleu,
        "les pixels changés changent bien le produit"
    );
    assert_ne!(
        cle_rouge, cle_bleue,
        "une image changée doit changer la clé exposée au consommateur"
    );

    fs::write(&image, png([255, 0, 0, 255])).expect("image rouge revenue");
    let (cle_revenue, sidecar_revenu) = cle_et_sidecar(&options);
    assert_eq!(
        (cle_rouge, sidecar_rouge),
        (cle_revenue, sidecar_revenu),
        "revenue à l'image d'avant, la source retrouve sa clé"
    );
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : une image qui apparaît ou disparaît à côté d'une scène inchangée change la clé
// autant qu'une image dont les octets changent — l'absence est un état, pas un silence.
#[test]
fn une_image_liee_absente_puis_presente_change_la_cle_exposee() {
    let (root, options, image) = source_texturee();
    let (absente, _) = cle_et_sidecar(&options);
    fs::write(&image, png([0, 255, 0, 255])).expect("image verte");
    let (presente, _) = cle_et_sidecar(&options);
    assert_ne!(
        absente, presente,
        "une image apparue doit changer la clé exposée"
    );
    fs::remove_file(&image).expect("retrait");
    let (retiree, _) = cle_et_sidecar(&options);
    assert_eq!(absente, retiree, "l'image retirée rend la clé d'avant");
    fs::remove_dir_all(root).expect("nettoyage");
}
