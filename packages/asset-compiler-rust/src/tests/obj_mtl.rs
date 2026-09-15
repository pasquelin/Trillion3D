//! Ce qu'un OBJ entraîne avec lui : sa bibliothèque de matériaux et les fichiers d'images qu'elle
//! nomme. Trois comportements se prouvent ici, hors dorée, parce qu'ils demandent de **modifier** la
//! source entre deux compilations ou de lui donner un nom que rien du corpus ne porte.
use super::*;

/// Un OBJ minuscule, un triangle, un matériau, et la bibliothèque qu'il cite.
fn obj_source(root: &Path, mtl: &str) -> PathBuf {
    let source = root.join("obj");
    fs::create_dir_all(&source).expect("dossier obj");
    fs::write(
        source.join("scene.obj"),
        "mtllib scene.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nusemtl Uni\nf 1//1 2//1 3//1\n",
    )
    .expect("obj");
    if !mtl.is_empty() {
        fs::write(source.join("scene.mtl"), mtl).expect("mtl");
    }
    source.join("scene.obj")
}

/// Compile et rend la clé de la scène intermédiaire avec ce que l'import en a écrit. La clé se lit
/// dans l'avancement du pilote : c'est elle que le cache réutilise, ou non.
fn import_key(options: &Options) -> (String, Value, Value) {
    let keys = std::sync::Mutex::new(Vec::new());
    compile(options, |report| {
        if report["phase"] == "import-source" {
            if let Some(key) = report["key"].as_str() {
                keys.lock().expect("clés").push(key.to_string());
            }
        }
    })
    .expect("compile obj");
    let key = keys.into_inner().expect("clés").pop().expect("une clé");
    let directory = options.cache.join("native").join("imports").join(&key);
    (
        key,
        read_json(&directory.join("model.gltf")),
        read_json(&directory.join("manifest.json")),
    )
}

// Comportement : la clé du cache couvre la bibliothèque de matériaux. Le même OBJ, dont seul le
// `.mtl` change, donne une autre clé et une autre couleur — jamais la scène d'avant.
#[test]
fn un_mtl_modifie_donne_une_autre_cle_et_une_autre_couleur() {
    let (root, mut options) = fixture();
    options.source = obj_source(&root, "newmtl Uni\nKd 1 0 0\n");
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
    options.source = obj_source(&root, "");
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
    options.source = obj_source(&root, "newmtl Uni\nKd 0.");
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
    options.source = obj_source(&root, "newmtl Uni\nKd 1 1 1\nmap_Kd color%red.png\n");
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
