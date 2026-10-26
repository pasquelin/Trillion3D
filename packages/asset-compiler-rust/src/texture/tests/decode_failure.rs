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
    let dir = scratch("texture-preview", "decode-failure");
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
    let dir = scratch("texture-preview", "decode-missing");
    let (previews, report) = stage_one_texture(&dir);
    assert!(previews.is_empty());
    assert_eq!(report["skipped"]["image-missing"], json!(1));
}

// Behaviour: a texture whose only image is an extension's (`EXT_texture_webp`) is read as any: its
// image is decoded — here a truncated one, reported as such — and the texture is not skipped as one
// without an image, as the table that publishes it and the bakes that read it name its image alike
// (`texture::binding`).
#[test]
fn a_texture_whose_only_image_is_an_extensions_is_read() {
    let dir = scratch("texture-preview", "extension-image");
    fs::write(dir.join("broken.png"), b"\x89PNG\r\n\x1a\nnot really a png").expect("write");
    let mut scene = scene_with_one_texture();
    scene["textures"] = json!([{"extensions": {"EXT_texture_webp": {"source": 0}}}]);
    let (previews, report) = stage_scene(&dir, &scene);
    assert!(previews.is_empty());
    assert_eq!(report["skipped"]["image-decode-failed"], json!(1));
    assert!(report["skipped"].get("texture-without-image").is_none());
}
