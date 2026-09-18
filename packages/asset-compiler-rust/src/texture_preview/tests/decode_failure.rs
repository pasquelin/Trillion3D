use super::*;

fn scene_with_one_texture() -> Value {
    json!({
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
        "meshes": [{"primitives": [{"attributes": {}, "material": 0}]}],
        "textures": [{"source": 0}],
        "images": [{"uri": "broken.png"}],
    })
}

/// L'étape jouée sur un dossier qui ne porte qu'une image, celle de `scene_with_one_texture`.
fn stage_one_texture(dir: &Path) -> (Vec<TexturePreview>, Value) {
    stage_scene(dir, &scene_with_one_texture())
}

// Comportement 7 : un décodage impossible (ici un PNG tronqué) est une entrée de rapport, zéro
// aperçu — jamais une erreur qui ferait échouer la compilation.
#[test]
fn an_undecodable_image_is_reported_and_yields_no_preview() {
    let dir = temp_dir("decode-failure");
    fs::write(dir.join("broken.png"), b"\x89PNG\r\n\x1a\nnot really a png").expect("write");
    let (previews, report) = stage_one_texture(&dir);
    assert!(previews.is_empty());
    assert_eq!(report["previews"], json!(0));
    assert_eq!(report["colorTextures"], json!(1));
    assert_eq!(report["skipped"]["image-decode-failed"], json!(1));
}

// Comportement 7 (suite) : une image absente du disque a le même sort — une raison de rapport
// dédiée, pas un échec.
#[test]
fn a_missing_image_file_is_reported_and_yields_no_preview() {
    let dir = temp_dir("decode-missing");
    let (previews, report) = stage_one_texture(&dir);
    assert!(previews.is_empty());
    assert_eq!(report["skipped"]["image-missing"], json!(1));
}
