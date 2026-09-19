//! What the driver produced, read as a caller would read it: the scene compiled in a throwaway
//! directory, then the values the tests compare.
use super::*;
use std::sync::atomic::AtomicBool;

/// Compiles these bytes through the driver in a throwaway directory, and yields the glTF and the
/// manifest it wrote — the manifest carries the counts and the report codes.
pub(super) fn compiled(bytes: &[u8], tag: &str) -> (Value, Value) {
    let root = std::env::temp_dir().join(format!(
        "wg-blend-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    let source = root.join("scene.blend");
    fs::create_dir_all(&root).expect("directory");
    fs::write(&source, bytes).expect("write");
    let cache = root.join("cache");
    let directory = convert::convert(
        &SceneRequest {
            source: &source,
            inputs: std::slice::from_ref(&source),
            cache: &cache,
            cancelled: &AtomicBool::new(false),
            progress: &|_| {},
        },
        &BLEND,
    )
    .expect("conversion");
    let read = |name: &str| -> Value {
        serde_json::from_slice(&fs::read(directory.join(name)).expect(name)).expect(name)
    };
    let pair = (read("model.gltf"), read("manifest.json"));
    fs::remove_dir_all(&root).expect("cleanup");
    pair
}

/// The glTF material of this name, in a compiled scene.
pub(super) fn material<'a>(gltf: &'a Value, name: &str) -> &'a Value {
    gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .find(|material| material["name"] == json!(name))
        .unwrap_or_else(|| panic!("no material named {name}"))
}

/// The factors of a glTF material, read as numbers to be compared to an f32 tolerance.
pub(super) fn factors(material: &Value, path: &[&str]) -> Vec<f64> {
    let mut found = material;
    for step in path {
        found = &found[*step];
    }
    found
        .as_array()
        .unwrap_or_else(|| panic!("{path:?} is not an array: {material}"))
        .iter()
        .map(|part| part.as_f64().expect("a number"))
        .collect()
}

pub(super) fn close(found: &[f64], wanted: &[f64]) -> bool {
    found.len() == wanted.len()
        && found
            .iter()
            .zip(wanted)
            .all(|(one, other)| (one - other).abs() < 1e-6)
}
