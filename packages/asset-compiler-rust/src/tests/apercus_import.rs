//! Aperçus d'une scène passée par un pilote d'import. Un format converti écrit sa scène
//! intermédiaire dans le cache, mais ses images restent dans le dossier source, à côté du fichier
//! d'origine : c'est la forme du Village, un FBX de 409 Mo dont les PNG voisinent le `.fbx`.
//!
//! La dorée des aperçus compile un glTF livré tel quel, où la scène et ses images partagent un
//! dossier ; elle ne peut donc pas voir une racine de résolution qui se déplace. Ce test-ci ne
//! regarde que cela : les aperçus retrouvent-ils les octets d'une image laissée à la source.
use super::*;

/// La fixture FBX des dorées, recopiée dans un dossier jetable avec de vraies images à côté. Le FBX
/// nomme `albedo.png` en `DiffuseColor` : c'est la texture couleur dont l'aperçu est attendu.
fn fbx_with_external_images() -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let source = root.join("fbx");
    fs::create_dir_all(&source).expect("dossier fbx");
    let fbx = fs::read(golden_dir("import-fbx").join("riviere.fbx")).expect("fixture");
    fs::write(source.join("riviere.fbx"), &fbx).expect("fbx");
    for (name, tint) in [("albedo.png", 0u8), ("opacite.png", 128u8)] {
        fs::write(source.join(name), png_bytes(tint)).expect("png");
    }
    options.source = source.join("riviere.fbx");
    options.scope = "full".into();
    options.triangle_budget = 150_000;
    (root, options)
}

/// Un vrai PNG 40×24 : ni carré, ni multiple de seize, et assez grand pour que sa pyramide porte
/// plusieurs niveaux. Seul compte ici qu'un décodeur du registre sache le relire.
fn png_bytes(tint: u8) -> Vec<u8> {
    let image = image::RgbaImage::from_fn(40, 24, |x, y| {
        image::Rgba([(x * 255 / 39) as u8, (y * 255 / 23) as u8, tint, 255])
    });
    let mut out = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png");
    out
}

// Comportement : les images d'une scène convertie se résolvent sous le dossier source, jamais sous
// le dossier du cache où le pilote a écrit la scène intermédiaire.
#[test]
fn les_apercus_dune_scene_convertie_lisent_les_images_restees_a_la_source() {
    let (root, options) = fbx_with_external_images();
    let result = compile(&options, |_| {}).expect("compile fbx");
    let report = &result["texturePreviews"];
    assert_eq!(
        report["colorTextures"], 1,
        "la scène importée déclare une texture couleur: {report}"
    );
    assert!(
        report["skipped"]["image-missing"].is_null(),
        "aucune image ne doit manquer: {report}"
    );
    assert_eq!(
        report["previews"], 1,
        "la texture couleur porte son aperçu: {report}"
    );
    fs::remove_dir_all(root).expect("nettoyage");
}
