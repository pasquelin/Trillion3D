//! Previews of a scene that went through an import driver. A converted format
//! writes its intermediate scene in the cache, but its images stay in the source
//! folder, next to the original file: that is the Village shape, a 409 MB FBX
//! whose PNGs sit beside the `.fbx`.
//!
//! The preview golden compiles a glTF delivered as-is, where the scene and its
//! images share a folder; it therefore cannot see a resolution root that moves.
//! This test looks only at that: do the previews find the bytes of an image left
//! at the source.
use super::*;

/// The golden FBX fixture, copied into a throwaway folder with real images beside
/// it. The FBX names `albedo.png` as `DiffuseColor`: that is the colour texture
/// whose preview is expected.
fn fbx_with_external_images() -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let source = root.join("fbx");
    fs::create_dir_all(&source).expect("fbx dir");
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

/// A real 40×24 PNG: neither square nor a multiple of sixteen, and large enough
/// for its pyramid to carry several levels. All that counts here is that a
/// registry decoder can reread it.
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

// Behaviour: images of a converted scene resolve under the source folder, never
// under the cache folder where the driver wrote the intermediate scene.
#[test]
fn previews_of_converted_scene_read_images_remaining_at_source() {
    let (root, options) = fbx_with_external_images();
    let result = compile(&options, |_| {}).expect("compile fbx");
    let report = &result["texturePreviews"];
    assert_eq!(
        report["colorTextures"], 1,
        "the imported scene declares a colour texture: {report}"
    );
    assert!(
        report["skipped"]["image-missing"].is_null(),
        "no image must be missing: {report}"
    );
    assert_eq!(
        report["previews"], 1,
        "the colour texture carries its preview: {report}"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
