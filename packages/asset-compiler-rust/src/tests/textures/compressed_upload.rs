//! Container → published scene → block file, with the existing pixel fallback retained.
use super::*;
use basisu::{DecodeFlags, TargetFormat, Transcoder};

#[test]
fn compiled_basis_textures_publish_the_native_bytes_named_by_scene_tables() {
    let source = golden_dir("ktx2");
    let (options, root) = golden_options(&source.join("scene.gltf"), "compressed-upload");
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().unwrap());
    let scene: Value =
        serde_json::from_slice(&fs::read(directory.join("source.gltf")).unwrap()).unwrap();
    let tables: Value =
        serde_json::from_slice(&fs::read(directory.join("scene-tables.json")).unwrap()).unwrap();
    assert!(scene["images"][0]
        .pointer("/extras/trillion3dCompressed")
        .is_none());
    for (rank, name) in [(1, "uastc.ktx2"), (2, "basis.ktx2")] {
        let blocks = &scene["images"][rank]["extras"]["trillion3dCompressed"];
        assert_eq!(blocks["blockFormat"], "bc7-rgba-unorm");
        let written = fs::read(directory.join(blocks["uri"].as_str().unwrap())).unwrap();
        let file = fs::read(source.join(name)).unwrap();
        let reference = Transcoder::new(&file).unwrap();
        for (level, span) in blocks["levels"].as_array().unwrap().iter().enumerate() {
            let offset = span["offset"].as_u64().unwrap() as usize;
            let count = span["length"].as_u64().unwrap() as usize;
            assert_eq!(
                &written[offset..offset + count],
                reference
                    .transcode(level as u32, TargetFormat::Bc7Rgba, DecodeFlags::NONE)
                    .unwrap()
            );
        }
        // Metadata is present in the runtime tables as well as the human-readable source scene.
        assert!(serde_json::to_string(&tables)
            .unwrap()
            .contains(blocks["uri"].as_str().unwrap()));
    }
    assert!(
        result["texturePreviews"].is_object(),
        "pixel fallback still baked"
    );
    fs::remove_dir_all(root).unwrap();
}
