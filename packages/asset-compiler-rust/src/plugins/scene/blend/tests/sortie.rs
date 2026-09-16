//! Ce que le pilote a produit, lu comme un appelant le lirait : la scène compilée dans un dossier
//! jetable, puis les valeurs que les tests comparent.
use super::*;
use std::sync::atomic::AtomicBool;

/// Compile ces octets par le pilote dans un dossier jetable, et rend le glTF et le manifeste qu'il
/// a écrits — le manifeste porte les comptes et les codes du rapport.
pub(super) fn compiled(bytes: &[u8], tag: &str) -> (Value, Value) {
    let root = std::env::temp_dir().join(format!(
        "wg-blend-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("horloge")
            .as_nanos()
    ));
    let source = root.join("scene.blend");
    fs::create_dir_all(&root).expect("dossier");
    fs::write(&source, bytes).expect("écriture");
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
    fs::remove_dir_all(&root).expect("nettoyage");
    pair
}

/// Le matériau glTF de ce nom, dans une scène compilée.
pub(super) fn material<'a>(gltf: &'a Value, name: &str) -> &'a Value {
    gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .find(|material| material["name"] == json!(name))
        .unwrap_or_else(|| panic!("aucun matériau nommé {name}"))
}

/// Les facteurs d'un matériau glTF, lus en nombres pour être comparés à la tolérance d'un f32.
pub(super) fn factors(material: &Value, path: &[&str]) -> Vec<f64> {
    let mut found = material;
    for step in path {
        found = &found[*step];
    }
    found
        .as_array()
        .unwrap_or_else(|| panic!("{path:?} n'est pas un tableau: {material}"))
        .iter()
        .map(|part| part.as_f64().expect("un nombre"))
        .collect()
}

pub(super) fn close(found: &[f64], wanted: &[f64]) -> bool {
    found.len() == wanted.len()
        && found
            .iter()
            .zip(wanted)
            .all(|(one, other)| (one - other).abs() < 1e-6)
}
