//! Ce que le pilote `blend` reconnaît, ce qu'il produit et ce qu'il conserve, pris à la sortie du
//! pilote lui-même — avant que le compilateur ne découpe quoi que ce soit. La scène dorée, elle,
//! est dans `blend_golden.rs`.
use super::*;
use plugins::scene::{route, PreparedScene, Routed, SceneRequest};
use std::io::{Read, Write};

/// Le fichier de la fixture CC0, tel que Blender l'a écrit : compressé en Zstandard.
fn source() -> PathBuf {
    golden_dir("blend/procedural-materials").join("scene.blend")
}

/// Un dossier jetable, nommé par le cas qui l'utilise.
fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wg-blend-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// Passe la source par le routeur puis par le pilote qu'il choisit, et rend ce qu'il a écrit.
fn converted(from: &Path, cache: &Path) -> PathBuf {
    let prepared = match route(from).expect("routage") {
        Routed::Driver(plugin, inputs) => {
            assert_eq!(plugin.name(), "blend", "{}", from.display());
            plugin.prepare(&SceneRequest {
                source: from,
                inputs: &inputs,
                cache,
                cancelled: &AtomicBool::new(false),
                progress: &|_| {},
            })
        }
        Routed::Manifest => panic!("routé vers le manifeste"),
    };
    match prepared.expect("conversion") {
        PreparedScene::Converted { directory, .. } => directory,
        PreparedScene::Manifest | PreparedScene::InPlace(_) => {
            panic!("le pilote blend convertit toujours")
        }
    }
}

fn scene_gltf(directory: &Path) -> Value {
    serde_json::from_slice(&fs::read(directory.join("model.gltf")).expect("model.gltf"))
        .expect("model.gltf est un JSON valide")
}

// Comportement 29 : la scène partagée sort en un seul maillage instancié trois fois, triangulée en
// éventail, une primitive par indice de matériau de face, et chaque primitive porte ses UV.
#[test]
fn one_shared_mesh_becomes_one_gltf_mesh_instanced_three_times() {
    let cache = scratch("instances");
    let gltf = scene_gltf(&converted(&source(), &cache));
    let nodes = gltf["nodes"].as_array().expect("nodes");
    assert_eq!(nodes.len(), 4, "une racine d'axes et trois instances");
    let meshes = gltf["meshes"].as_array().expect("meshes");
    assert_eq!(
        meshes.len(),
        1,
        "le maillage partagé n'est écrit qu'une fois"
    );
    for node in nodes.iter().skip(1) {
        assert_eq!(node["mesh"], json!(0), "{node}");
    }
    let primitives = meshes[0]["primitives"].as_array().expect("primitives");
    assert_eq!(primitives.len(), 3, "trois indices de matériau de face");
    for primitive in primitives {
        let indices = primitive["indices"].as_u64().expect("indices") as usize;
        assert_eq!(
            gltf["accessors"][indices]["count"], 12,
            "deux quads, donc quatre triangles"
        );
        assert!(
            primitive["attributes"]["TEXCOORD_0"].is_u64(),
            "la couche d'UV suit chaque primitive"
        );
        assert!(primitive["material"].is_u64(), "{primitive}");
    }
    fs::remove_dir_all(cache).expect("nettoyage");
}

// Comportement 30 : l'enveloppe ne change rien. Le même fichier réempaqueté en gzip donne, octet
// pour octet, le même glTF intermédiaire que l'original compressé en Zstandard.
#[test]
fn a_gzipped_file_gives_exactly_the_same_scene_as_the_zstandard_one() {
    let dir = scratch("gzip");
    let plain = unpacked();
    assert!(
        plain.starts_with(b"BLENDER"),
        "le fichier déballé est un .blend"
    );
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&plain).expect("gzip");
    let gzipped = dir.join("scene.blend");
    fs::write(&gzipped, encoder.finish().expect("gzip")).expect("écriture");
    let raw = dir.join("brut").join("scene.blend");
    fs::create_dir_all(raw.parent().expect("dossier")).expect("dossier");
    fs::write(&raw, &plain).expect("écriture");
    let cache = scratch("gzip-cache");
    let from_gzip = fs::read(converted(&gzipped, &cache).join("model.gltf")).expect("gzip");
    let from_raw = fs::read(converted(&raw, &cache).join("model.gltf")).expect("brut");
    let from_zstd = fs::read(converted(&source(), &cache).join("model.gltf")).expect("zstd");
    assert_eq!(
        from_gzip, from_zstd,
        "gzip et Zstandard donnent la même scène"
    );
    assert_eq!(from_raw, from_zstd, "un fichier nu donne la même scène");
    fs::remove_dir_all(dir).expect("nettoyage");
    fs::remove_dir_all(cache).expect("nettoyage");
}

// Comportement 31 : une image empaquetée dans le fichier ressort dans le binaire de la scène octet
// pour octet — le PNG que Blender a avalé, pas une réécriture.
#[test]
fn a_packed_image_is_carried_through_byte_for_byte() {
    let cache = scratch("packed");
    let directory = converted(&source(), &cache);
    let gltf = scene_gltf(&directory);
    let bin = fs::read(directory.join("model.bin")).expect("model.bin");
    let images = gltf["images"].as_array().expect("images");
    assert_eq!(images.len(), 1, "une seule image dans cette scène");
    assert_eq!(images[0]["mimeType"], "image/png");
    let view = images[0]["bufferView"].as_u64().expect("vue de tampon") as usize;
    let from = gltf["bufferViews"][view]["byteOffset"]
        .as_u64()
        .expect("offset") as usize;
    let length = gltf["bufferViews"][view]["byteLength"]
        .as_u64()
        .expect("longueur") as usize;
    let carried = &bin[from..from + length];
    let plain = unpacked();
    let start = find(&plain, b"\x89PNG\r\n\x1a\n").expect("le PNG empaqueté");
    let end = find(&plain[start..], b"IEND").expect("la fin du PNG") + start + 8;
    assert_eq!(
        carried,
        &plain[start..end],
        "les octets du PNG sont conservés"
    );
    fs::remove_dir_all(cache).expect("nettoyage");
}

/// Les octets du fichier de la fixture une fois déballés. Blender écrit son Zstandard en plusieurs
/// trames, précédées d'une trame ignorable : le test les enchaîne comme le pilote le fait.
fn unpacked() -> Vec<u8> {
    let raw = fs::read(source()).expect("source");
    let mut rest = &raw[..];
    let mut out = Vec::new();
    while rest.len() >= 4 {
        let magic = u32::from_le_bytes(rest[..4].try_into().expect("nombre magique"));
        if magic & 0xFFFF_FFF0 == 0x184D_2A50 {
            let length = u32::from_le_bytes(rest[4..8].try_into().expect("longueur")) as usize;
            rest = &rest[8 + length..];
            continue;
        }
        if magic != 0xFD2F_B528 {
            break;
        }
        let mut frame = rest;
        let mut decoder = ruzstd::StreamingDecoder::new(&mut frame).expect("trame Zstandard");
        decoder.read_to_end(&mut out).expect("déballage");
        drop(decoder);
        rest = frame;
    }
    out
}

/// Le premier rang où `needle` apparaît dans `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
