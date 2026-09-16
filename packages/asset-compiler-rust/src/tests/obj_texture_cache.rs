//! A04 — Les textures que la bibliothèque d'un OBJ nomme ne sont pas ouvertes par le lecteur : leur
//! seule existence décide pourtant du contenu du glTF intermédiaire. Restées hors de l'identité de
//! l'import, une image ajoutée, retirée ou remplacée laissait servir la scène d'avant.
use super::*;

/// Un PNG lisible, dont la couleur distingue deux fichiers de même nom.
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

/// La source : un OBJ, sa bibliothèque qui nomme `color.png`, et le chemin de cette image.
fn source_avec_texture(root: &Path) -> (PathBuf, PathBuf) {
    let obj = obj_source(root, "obj", "newmtl Uni\nKd 1 1 1\nmap_Kd color.png\n");
    let image = obj.with_file_name("color.png");
    (obj, image)
}

/// L'URI de la première image du glTF intermédiaire, ou `Value::Null` quand il n'en porte aucune.
fn uri(gltf: &Value) -> Value {
    gltf["images"][0]["uri"].clone()
}

// Comportement : sur un cache déjà servi, une texture qui apparaît, change, puis disparaît change à
// chaque fois la clé de l'import — donc la scène servie.
#[test]
fn une_texture_ajoutee_apparait_dans_le_cache_existant() {
    let (root, mut options) = fixture();
    let (obj, image) = source_avec_texture(&root);
    options.source = obj;
    let (absente, gltf, _) = import_key(&options);
    assert_eq!(uri(&gltf), Value::Null, "l'image n'existe pas encore");

    fs::write(&image, png(200)).expect("image");
    let (presente, gltf, _) = import_key(&options);
    assert_ne!(
        absente, presente,
        "une texture apparue doit changer la clé de l'import"
    );
    assert_eq!(uri(&gltf), json!("color.png"));

    fs::write(&image, png(20)).expect("image");
    let (autre, gltf, _) = import_key(&options);
    assert_ne!(
        presente, autre,
        "des octets d'image changés doivent changer la clé"
    );
    assert_eq!(uri(&gltf), json!("color.png"));

    fs::remove_file(&image).expect("retrait");
    let (retiree, gltf, _) = import_key(&options);
    assert_eq!(
        retiree, absente,
        "revenue à l'état d'avant, la source retrouve sa clé"
    );
    assert_eq!(uri(&gltf), Value::Null, "l'image retirée disparaît");
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : un cache neuf et un cache déjà servi rendent la même scène pour la même source.
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
    assert_eq!(servi, neuf, "la clé ne dépend pas de l'état du cache");
    assert_eq!(uri(&servi_gltf), uri(&neuf_gltf));
    assert_eq!(uri(&neuf_gltf), json!("color.png"));
    fs::remove_dir_all(root).expect("nettoyage");
}
