//! Opacity of a classic FBX. `ufbx` only puts it in `pbr.opacity` for shaders that
//! declare an opacity; a `phong` material carries it in `fbx.transparency_*`. The
//! fixture `tests/fixtures/formats/import-fbx/riviere.fbx` reproduces that shape, the Village's.
use super::*;

/// Copies the FBX fixture into a throwaway folder with its two images.
/// `shared_texture` rewires the opacity map onto the base-colour texture, the
/// only case glTF can carry.
pub(in crate::tests) fn fbx_fixture(shared_texture: bool) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let source = root.join("fbx");
    fs::create_dir_all(&source).expect("fbx dir");
    let mut fbx =
        fs::read_to_string(golden_dir("import-fbx").join("riviere.fbx")).expect("fixture");
    if shared_texture {
        fbx = fbx.replace(
            "C: \"OP\",5000,3000, \"TransparentColor\"",
            "C: \"OP\",4000,3000, \"TransparentColor\"",
        );
    }
    fs::write(source.join("riviere.fbx"), &fbx).expect("fbx");
    for image in ["albedo.png", "opacite.png"] {
        fs::write(source.join(image), b"\x89PNG\r\n\x1a\nnot-a-real-png").expect("png");
    }
    options.source = source.join("riviere.fbx");
    options.scope = "full".into();
    options.triangle_budget = 150000;
    (root, options)
}

/// The imported glTF and the fixture's import manifest.
pub(in crate::tests) fn import_of(options: &Options) -> (Value, Value) {
    compile(options, |_| {}).expect("compile fbx");
    let imports = options.cache.join("native/imports");
    let entry = fs::read_dir(&imports)
        .expect("imports")
        .map(|e| e.expect("entry").path())
        .next()
        .expect("an import");
    (
        read_json(&entry.join("model.gltf")),
        read_json(&entry.join("manifest.json")),
    )
}

#[test]
fn classic_fbx_transparency_becomes_a_blended_material() {
    let (root, options) = fbx_fixture(false);
    let (gltf, manifest) = import_of(&options);
    let material = &gltf["materials"][0];
    assert_eq!(material["name"], "M_Riviere");
    // White TransparentColor weighted by TransparencyFactor 0.25: 0.75 opacity remains.
    assert_eq!(
        material["pbrMetallicRoughness"]["baseColorFactor"][3],
        json!(0.75)
    );
    assert_eq!(material["alphaMode"], "BLEND", "{material}");
    // Never a cutout: a masked transparent would be a fidelity loss.
    assert!(material["alphaCutoff"].is_null(), "{material}");
    // The opacity map is not the base-colour one: glTF cannot carry it, so the
    // report flags it instead of swallowing it.
    assert_eq!(
        manifest["unsupported"]["material-separate-opacity-texture"],
        json!(1),
        "{}",
        manifest["unsupported"]
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn an_opacity_map_shared_with_base_colour_binds_without_a_report() {
    let (root, options) = fbx_fixture(true);
    let (gltf, manifest) = import_of(&options);
    let material = &gltf["materials"][0];
    assert_eq!(material["alphaMode"], "BLEND", "{material}");
    assert_eq!(
        material["pbrMetallicRoughness"]["baseColorTexture"]["index"],
        json!(0)
    );
    assert!(
        manifest["unsupported"]["material-separate-opacity-texture"].is_null(),
        "{}",
        manifest["unsupported"]
    );
    fs::remove_dir_all(root).expect("cleanup");
}

/// Classic FBX convention, isolated: `TransparentColor` is a transparency, not an opacity.
#[test]
fn transparent_color_black_means_opaque() {
    use crate::import::opacity::opacity_from_transparency as opacity;
    // The form of `M_Water_Ocean` in Village: black colour, full factor.
    assert_eq!(opacity([0.0, 0.0, 0.0], 1.0), 1.0);
    assert_eq!(opacity([1.0, 1.0, 1.0], 0.25), 0.75);
    assert_eq!(opacity([1.0, 1.0, 1.0], 1.0), 0.0);
    // Out of bounds on both sides: opacity stays between 0 and 1.
    assert_eq!(opacity([2.0, 2.0, 2.0], 1.0), 0.0);
    assert_eq!(opacity([-1.0, -1.0, -1.0], 1.0), 1.0);
}
