//! Reproduire un défaut sur la fixture CC0, sans Blender et sans écrire dans `fixtures/`.
//!
//! La fixture est déballée de son enveloppe, puis retouchée **par le SDNA qu'elle porte
//! elle-même** : aucun décalage n'est écrit en dur ici non plus, chaque champ est retrouvé par son
//! nom comme le pilote le fait. Un pointeur réécrit, un flottant réécrit, un bloc dupliqué : ce
//! sont des fichiers que Blender aurait pu écrire, et le pilote les relit par le même chemin que
//! la fixture d'origine.
use super::*;
use std::sync::atomic::AtomicBool;

/// L'entête d'un bloc à champs de soixante-quatre bits, celui de la fixture.
const HEADER: usize = 32;
/// L'adresse d'origine donnée au bloc ajouté : elle n'appartient à aucun bloc de la fixture.
const SPARE: u64 = 0xB1E0_0000_0000_0001;

/// Les octets de la fixture CC0, déballés de leur enveloppe Zstandard.
pub(super) fn fixture() -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/blend/procedural-materials/scene.blend");
    let raw = fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    envelope::unwrap(&raw, MAX_BYTES).expect("l'enveloppe de la fixture")
}

/// L'adresse d'origine du bloc identifié par ce nom, préfixe de genre compris.
pub(super) fn named(file: &BlendFile, name: &str) -> u64 {
    file.blocks
        .iter()
        .find(|block| file.view(block).is_some_and(|view| view.id_name() == name))
        .map(|block| block.old)
        .unwrap_or_else(|| panic!("aucun bloc nommé {name}"))
}

/// Le rang, dans les octets du fichier, où commence un champ d'un bloc — le chemin traversant les
/// structures imbriquées, comme `["id", "name"]`.
pub(super) fn field(file: &BlendFile, old: u64, path: &[&str]) -> usize {
    let block = file.at(old).expect("le bloc demandé");
    let mut layout = file.dna.layout(block.sdna).expect("sa disposition");
    let mut at = block.start;
    for (rank, step) in path.iter().enumerate() {
        let field = layout.field(step).unwrap_or_else(|| panic!("champ {step}"));
        at += field.offset;
        if rank + 1 < path.len() {
            let kind = file.dna.index(&field.kind).expect("type du champ");
            layout = file.dna.layout(kind).expect("sa disposition");
        }
    }
    at
}

/// La fixture augmentée d'un objet maillage qu'aucune collection de la scène ne porte : le bloc
/// d'un objet existant, recopié sous une autre adresse et un autre nom, glissé avant `ENDB`.
pub(super) fn with_stray_object(name: &[u8]) -> Vec<u8> {
    let mut bytes = fixture();
    let (mut data, sdna, at, end) = {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("la fixture");
        let old = named(&file, "OBSharedMesh_0");
        let block = file.at(old).expect("son bloc");
        let data = bytes[block.start..block.start + block.len].to_vec();
        let at = field(&file, old, &["id", "name"]) - block.start;
        let end = file.of(*b"ENDB").next().expect("le bloc ENDB").start - HEADER;
        (data, block.sdna as u32, at, end)
    };
    data[at..at + name.len()].copy_from_slice(name);
    data[at + name.len()] = 0;
    let mut added = b"OB\0\0".to_vec();
    added.extend_from_slice(&sdna.to_le_bytes());
    added.extend_from_slice(&SPARE.to_le_bytes());
    added.extend_from_slice(&(data.len() as u64).to_le_bytes());
    added.extend_from_slice(&1u64.to_le_bytes());
    added.extend_from_slice(&data);
    bytes.splice(end..end, added);
    bytes
}

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
