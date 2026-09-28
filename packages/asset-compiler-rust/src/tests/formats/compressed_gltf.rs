//! Transport compression must leave the compiler's published scene products unchanged.
use super::*;
use std::io::Write;
mod sources;

fn write_source(root: &Path, name: &str, mut g: Value, bytes: &[u8]) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    g["buffers"][0]["uri"] = json!("data.bin");
    fs::write(dir.join("data.bin"), bytes).unwrap();
    fs::write(dir.join("scene.gltf"), serde_json::to_vec(&g).unwrap()).unwrap();
    dir.join("scene.gltf")
}
fn compare_products(first: &GoldenRun, second: &GoldenRun) {
    // Deliberately omit source/cache keys: encodings have different input bytes.
    assert_eq!(
        compiled_identity(first, json!({})),
        compiled_identity(second, json!({}))
    );
    assert_eq!(first.previews, second.previews, "material previews");
    assert!(first.result["sourceTriangles"].as_u64().unwrap() > 0);
}
fn archived(source: &Path) -> PathBuf {
    let archive = source.with_extension("zip");
    let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
    for name in ["scene.gltf", "data.bin"] {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&fs::read(source.with_file_name(name)).unwrap())
            .unwrap();
    }
    zip.finish().unwrap();
    archive
}
#[test]
fn compressed_sources_and_archives_cook_like_their_decoded_geometry() {
    let root = scratch("compression", "cook-products");
    for (name, ((plain, raw), (compressed, encoded))) in
        [("draco", sources::draco()), ("meshopt", sources::meshopt())]
    {
        let plain = write_source(&root, &format!("{name}-plain"), plain, &raw);
        let compressed = write_source(&root, name, compressed, &encoded);
        let reference = compile_golden_source(&plain, &format!("{name}-reference"));
        let direct = compile_golden_source(&compressed, &format!("{name}-compressed"));
        compare_products(&direct, &reference);
        let archive = compile_golden_source(&archived(&compressed), &format!("{name}-archive"));
        compare_products(&archive, &direct);
        assert_eq!(direct.result["scenePlugin"]["name"], "gltf");
        assert_eq!(chain_report(&archive)[1]["name"], "gltf");
    }
    fs::remove_dir_all(root).unwrap();
}
