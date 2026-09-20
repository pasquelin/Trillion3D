//! A04 — Textures an OBJ library names are not opened by the reader: their mere
//! existence nevertheless decides the intermediate glTF. Left out of import
//! identity, an image added, removed or replaced left the previous scene in service.
use super::*;

/// A readable PNG, whose colour distinguishes two files of the same name.
fn png(teinte: u8) -> Vec<u8> {
    let image =
        image::RgbaImage::from_fn(8, 8, |x, y| image::Rgba([teinte, x as u8, y as u8, 255]));
    let mut bytes = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .expect("png");
    bytes
}

/// The source: an OBJ, its library that names `color.png`, and the path of that image.
fn source_avec_texture(root: &Path) -> (PathBuf, PathBuf) {
    let obj = obj_source(root, "obj", "newmtl Uni\nKd 1 1 1\nmap_Kd color.png\n");
    let image = obj.with_file_name("color.png");
    (obj, image)
}

/// URI of the first image of the intermediate glTF, or `Value::Null` when it carries none.
fn uri(gltf: &Value) -> Value {
    gltf["images"][0]["uri"].clone()
}

// Behaviour: on a cache already served, a texture that appears, changes, then
// disappears changes the import key each time — therefore the scene served.
#[test]
fn une_texture_ajoutee_apparait_dans_le_cache_existant() {
    let (root, mut options) = fixture();
    let (obj, image) = source_avec_texture(&root);
    options.source = obj;
    let (absente, gltf, _) = import_key(&options);
    assert_eq!(uri(&gltf), Value::Null, "the image does not exist yet");

    fs::write(&image, png(200)).expect("image");
    let (presente, gltf, _) = import_key(&options);
    assert_ne!(
        absente, presente,
        "a texture that appeared must change the import key"
    );
    assert_eq!(uri(&gltf), json!("color.png"));

    fs::write(&image, png(20)).expect("image");
    let (autre, gltf, _) = import_key(&options);
    assert_ne!(presente, autre, "changed image bytes must change the key");
    assert_eq!(uri(&gltf), json!("color.png"));

    fs::remove_file(&image).expect("remove");
    let (retiree, gltf, _) = import_key(&options);
    assert_eq!(
        retiree, absente,
        "back to the previous state, the source finds its key again"
    );
    assert_eq!(uri(&gltf), Value::Null, "the removed image disappears");
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a fresh cache and a cache already served yield the same scene for the same source.
#[test]
fn un_cache_neuf_et_un_cache_servi_rendent_la_meme_scene() {
    let (root, mut options) = fixture();
    let (obj, image) = source_avec_texture(&root);
    options.source = obj;
    let (_, gltf, _) = import_key(&options);
    assert_eq!(uri(&gltf), Value::Null);
    fs::write(&image, png(200)).expect("image");
    let (servi, servi_gltf, _) = import_key(&options);
    let neuf_options = Options {
        cache: root.join("cache-neuf"),
        ..options.clone()
    };
    let (neuf, neuf_gltf, _) = import_key(&neuf_options);
    assert_eq!(servi, neuf, "the key does not depend on cache state");
    assert_eq!(uri(&servi_gltf), uri(&neuf_gltf));
    assert_eq!(uri(&neuf_gltf), json!("color.png"));
    fs::remove_dir_all(root).expect("cleanup");
}
