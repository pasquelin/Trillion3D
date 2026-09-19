//! A05 — Linked glTF images are read after the key is computed: their pixels
//! enter the product — sidecar texture previews — without entering the identity
//! that names it. A red PNG replaced by a blue PNG therefore left the key intact
//! while `clusters.bin` changed, and a consumer that reuses by the key kept the
//! previous previews.
use super::*;

/// A solid 8×8 PNG, whose colour distinguishes two files of the same name.
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

/// The fixture, whose only material carries a base colour linked to `color.png`.
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

/// Compiles and returns the key exposed to the consumer with the fingerprint of
/// the binary sidecar written under that key.
/// elle : c'est ce couple qui doit bouger ensemble, ou pas du tout.
fn cle_et_sidecar(options: &Options) -> (String, String) {
    let result = compile(options, |_| {}).expect("compile");
    let key = result["key"].as_str().expect("key").to_string();
    let sidecar = options
        .cache
        .join("native")
        .join(&options.scope)
        .join(&key)
        .join(MANIFEST_BINARY_FILE);
    let bytes = fs::read(sidecar).expect("sidecar binaire");
    (key, hash(&bytes))
}

// Behaviour: a linked image that changes changes the exposed key; the same image
// yields the same key,
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
        "two identical compilations yield the same key and the same sidecar"
    );

    fs::write(&image, png([0, 0, 255, 255])).expect("image bleue");
    let (cle_bleue, sidecar_bleu) = cle_et_sidecar(&options);
    assert_ne!(
        sidecar_rouge, sidecar_bleu,
        "changed pixels do change the product"
    );
    assert_ne!(
        cle_rouge, cle_bleue,
        "a changed image must change the key exposed to the consumer"
    );

    fs::write(&image, png([255, 0, 0, 255])).expect("image rouge revenue");
    let (cle_revenue, sidecar_revenu) = cle_et_sidecar(&options);
    assert_eq!(
        (cle_rouge, sidecar_rouge),
        (cle_revenue, sidecar_revenu),
        "back to the previous image, the source finds its key again"
    );
    fs::remove_dir_all(root).expect("nettoyage");
}

// Behaviour: an image that appears or disappears next to an unchanged scene
// changes the key as much as an image whose bytes change — absence is a state,
// not silence.
#[test]
fn une_image_liee_absente_puis_presente_change_la_cle_exposee() {
    let (root, options, image) = source_texturee();
    let (absente, _) = cle_et_sidecar(&options);
    fs::write(&image, png([0, 255, 0, 255])).expect("image verte");
    let (presente, _) = cle_et_sidecar(&options);
    assert_ne!(
        absente, presente,
        "an image that appeared must change the exposed key"
    );
    fs::remove_file(&image).expect("retrait");
    let (retiree, _) = cle_et_sidecar(&options);
    assert_eq!(
        absente, retiree,
        "the removed image yields the previous key"
    );
    fs::remove_dir_all(root).expect("nettoyage");
}
