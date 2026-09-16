//! Ce qu'un OBJ entraîne avec lui : sa bibliothèque de matériaux et les fichiers d'images qu'elle
//! nomme. Trois comportements se prouvent ici, hors dorée, parce qu'ils demandent de **modifier** la
//! source entre deux compilations ou de lui donner un nom que rien du corpus ne porte.
use super::*;

// Comportement : la clé du cache couvre la bibliothèque de matériaux. Le même OBJ, dont seul le
// `.mtl` change, donne une autre clé et une autre couleur — jamais la scène d'avant.
#[test]
fn un_mtl_modifie_donne_une_autre_cle_et_une_autre_couleur() {
    let (root, mut options) = fixture();
    options.source = obj_source(&root, "obj", "newmtl Uni\nKd 1 0 0\n");
    let (rouge, gltf, _) = import_key(&options);
    assert_eq!(
        gltf["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"],
        json!([1.0, 0.0, 0.0, 1.0])
    );
    fs::write(
        options.source.with_file_name("scene.mtl"),
        "newmtl Uni\nKd 0 1 0\n",
    )
    .expect("mtl");
    let (vert, gltf, _) = import_key(&options);
    assert_ne!(rouge, vert, "un .mtl modifié doit changer la clé du cache");
    assert_eq!(
        gltf["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"],
        json!([0.0, 1.0, 0.0, 1.0]),
        "la scène servie doit suivre le .mtl"
    );
    // Et la source inchangée se réutilise : la clé ne bouge qu'avec les octets qu'elle couvre.
    let (encore, _, manifest) = import_key(&options);
    assert_eq!(vert, encore);
    assert_eq!(manifest["source"]["external"][0]["file"], "scene.mtl");
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : une bibliothèque citée mais introuvable est comptée par son nom, pas laissée dans
// une note en texte libre.
#[test]
fn une_bibliotheque_absente_est_comptee_par_son_nom() {
    let (root, mut options) = fixture();
    options.source = obj_source(&root, "obj", "");
    let (_, _, manifest) = import_key(&options);
    assert_eq!(
        manifest["unsupported"]["material-library-missing"],
        json!(1),
        "{}",
        manifest["unsupported"]
    );
    assert_eq!(manifest["notes"], json!([]), "{}", manifest["notes"]);
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : une bibliothèque coupée au milieu d'une déclaration se lit quand même — le lecteur
// en retient une valeur incomplète —, et c'est cela qui est compté par son nom.
#[test]
fn une_bibliotheque_tronquee_est_comptee_par_son_nom() {
    let (root, mut options) = fixture();
    options.source = obj_source(&root, "obj", "newmtl Uni\nKd 0.");
    let (_, _, manifest) = import_key(&options);
    assert_eq!(
        manifest["unsupported"]["material-library-truncated"],
        json!(1),
        "{}",
        manifest["unsupported"]
    );
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : un nom de fichier qui porte un caractère réservé d'URI ressort échappé, et l'aperçu
// le relit. Sans échappement, `%re` se décodait en octet invalide et l'image était perdue.
#[test]
fn un_nom_de_texture_a_echapper_reste_relisible() {
    let (root, mut options) = fixture();
    options.source = obj_source(&root, "obj", "newmtl Uni\nKd 1 1 1\nmap_Kd color%red.png\n");
    let image = image::RgbaImage::from_fn(8, 8, |x, y| image::Rgba([x as u8, y as u8, 7, 255]));
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("png");
    fs::write(options.source.with_file_name("color%red.png"), &png).expect("texture");
    let keys = std::sync::Mutex::new(Vec::new());
    let result = compile(&options, |report| {
        if report["phase"] == "import-source" {
            if let Some(key) = report["key"].as_str() {
                keys.lock().expect("clés").push(key.to_string());
            }
        }
    })
    .expect("compile obj");
    let key = keys.into_inner().expect("clés").pop().expect("une clé");
    let gltf = read_json(
        &options
            .cache
            .join("native")
            .join("imports")
            .join(&key)
            .join("model.gltf"),
    );
    assert_eq!(gltf["images"][0]["uri"], "color%25red.png");
    assert_eq!(result["texturePreviews"]["previews"], json!(1));
    assert_eq!(
        result["texturePreviews"]["skipped"],
        json!({}),
        "{}",
        result["texturePreviews"]
    );
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : deux OBJ aux octets identiques, posés dans deux dossiers avec chacun sa
// bibliothèque, ne se servent pas la scène l'un de l'autre. Le relevé des fichiers ouverts appartient
// au dossier qui les résout ; tenu par le seul contenu de la source, il rendait au second la clé du
// premier, et avec elle sa couleur.
#[test]
fn deux_dossiers_au_meme_obj_gardent_chacun_leur_mtl() {
    let (root, mut options) = fixture();
    let a = obj_source(&root, "A", "newmtl Uni\nKd 1 0 0\n");
    let b = obj_source(&root, "B", "newmtl Uni\nKd 0 1 0\n");
    let colour = |options: &Options| {
        import_key(options).1["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"].clone()
    };
    options.source = a.clone();
    assert_eq!(colour(&options), json!([1.0, 0.0, 0.0, 1.0]));
    options.source = b.clone();
    assert_eq!(
        colour(&options),
        json!([0.0, 1.0, 0.0, 1.0]),
        "B doit suivre sa propre bibliothèque"
    );
    options.source = a;
    assert_eq!(
        colour(&options),
        json!([1.0, 0.0, 0.0, 1.0]),
        "A garde la sienne après B"
    );
    fs::write(b.with_file_name("scene.mtl"), "newmtl Uni\nKd 0 0 1\n").expect("mtl");
    options.source = b;
    assert_eq!(
        colour(&options),
        json!([0.0, 0.0, 1.0, 1.0]),
        "la bibliothèque de B modifiée seule doit reconvertir B"
    );
    fs::remove_dir_all(root).expect("nettoyage");
}
