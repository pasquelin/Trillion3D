use super::*;

fn scene_with_one_texture() -> Value {
    json!({
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
        "meshes": [{"primitives": [{"attributes": {}, "material": 0}]}],
        "textures": [{"source": 0}],
        "images": [{"uri": "broken.png"}],
    })
}

/// Step run on folder with single image, that of `scene_with_one_texture`.
fn stage_one_texture(dir: &Path) -> (Vec<TexturePreview>, Value) {
    stage_scene(dir, &scene_with_one_texture())
}

// Behavior 7: failed decode (here truncated PNG) is report entry, zero
// preview — never an error failing compilation.
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

// Behavior 7 (cont): missing disk image same fate — dedicated
// report reason, not failure.
#[test]
fn a_missing_image_file_is_reported_and_yields_no_preview() {
    let dir = temp_dir("decode-missing");
    let (previews, report) = stage_one_texture(&dir);
    assert!(previews.is_empty());
    assert_eq!(report["skipped"]["image-missing"], json!(1));
}
