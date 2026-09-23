//! What an OBJ brings with it: its material library and the image files it names.
//! Three behaviours are proven here, outside the golden, because they require
//! **modifying** the source between two compilations or giving it a name nothing
//! in the corpus carries.
use super::*;

// Behaviour: the cache key covers the material library. The same OBJ, of which
// only the `.mtl` changes, yields another key and another colour — never the previous scene.
#[test]
fn a_modified_mtl_gives_another_key_and_another_colour() {
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
    assert_ne!(rouge, vert, "a modified .mtl must change the cache key");
    assert_eq!(
        gltf["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"],
        json!([0.0, 1.0, 0.0, 1.0]),
        "the served scene must follow the .mtl"
    );
    // And the unchanged source is reused: the key only moves with the bytes it covers.
    let (encore, _, manifest) = import_key(&options);
    assert_eq!(vert, encore);
    assert_eq!(manifest["source"]["external"][0]["file"], "scene.mtl");
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a cited but missing library is counted by name, not left in a free-text note.
#[test]
fn a_missing_library_is_counted_by_its_name() {
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
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a library cut in the middle of a declaration is still read — the
// reader keeps an incomplete value — and that is what is counted by its name.
#[test]
fn a_truncated_library_is_counted_by_its_name() {
    let (root, mut options) = fixture();
    options.source = obj_source(&root, "obj", "newmtl Uni\nKd 0.");
    let (_, _, manifest) = import_key(&options);
    assert_eq!(
        manifest["unsupported"]["material-library-truncated"],
        json!(1),
        "{}",
        manifest["unsupported"]
    );
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a filename that carries a reserved URI character comes out escaped,
// and the preview re-reads it. Without escaping, `%re` decoded as an invalid byte
// and the image was lost.
#[test]
fn a_texture_name_that_needs_escaping_stays_rereadable() {
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
                keys.lock().expect("keys").push(key.to_string());
            }
        }
    })
    .expect("compile obj");
    let key = keys.into_inner().expect("keys").pop().expect("a key");
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
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: two OBJ of identical bytes, placed in two folders each with its own
// library, do not serve each other the scene. The record of opened files belongs
// to the folder that resolves them; held by the source content alone, it gave the
// second the first's key, and with it its colour.
#[test]
fn two_folders_with_the_same_obj_each_keep_their_mtl() {
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
        "B must follow its own library"
    );
    options.source = a;
    assert_eq!(
        colour(&options),
        json!([1.0, 0.0, 0.0, 1.0]),
        "A keeps its own after B"
    );
    fs::write(b.with_file_name("scene.mtl"), "newmtl Uni\nKd 0 0 1\n").expect("mtl");
    options.source = b;
    assert_eq!(
        colour(&options),
        json!([0.0, 0.0, 1.0, 1.0]),
        "B's library modified alone must reconvert B"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
