//! What the `blend` driver recognises, produces and keeps, taken at the driver
//! output itself — before the compiler splits anything. The golden scene is in
//! `blend_golden.rs`.
use super::*;
use plugins::scene::{route, PreparedScene, Routed, SceneRequest};
use std::io::{Read, Write};

/// File of the CC0 fixture, as Blender wrote it: compressed with Zstandard.
fn source() -> PathBuf {
    golden_dir("blend/procedural-materials").join("scene.blend")
}

/// Passes the source through the router then the driver it picks, and returns what it wrote.
fn converted(from: &Path, cache: &Path) -> PathBuf {
    let prepared = match route(from).expect("routing") {
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
        Routed::Manifest => panic!("routed to the manifest"),
    };
    match prepared.expect("conversion") {
        PreparedScene::Converted { directory, .. } => directory,
        PreparedScene::Manifest | PreparedScene::InPlace(_) => {
            panic!("the blend driver always converts")
        }
    }
}

fn scene_gltf(directory: &Path) -> Value {
    serde_json::from_slice(&fs::read(directory.join("model.gltf")).expect("model.gltf"))
        .expect("model.gltf is valid JSON")
}

// Behaviour 29: the shared scene comes out as one mesh instanced three times,
// fan-triangulated, one primitive per face material index, and each primitive
// carries its UVs.
#[test]
fn one_shared_mesh_becomes_one_gltf_mesh_instanced_three_times() {
    let cache = scratch("blend", "instances");
    let gltf = scene_gltf(&converted(&source(), &cache));
    let nodes = gltf["nodes"].as_array().expect("nodes");
    assert_eq!(nodes.len(), 4, "one axis root and three instances");
    let meshes = gltf["meshes"].as_array().expect("meshes");
    assert_eq!(meshes.len(), 1, "the shared mesh is written only once");
    for node in nodes.iter().skip(1) {
        assert_eq!(node["mesh"], json!(0), "{node}");
    }
    let primitives = meshes[0]["primitives"].as_array().expect("primitives");
    assert_eq!(primitives.len(), 3, "three face material indices");
    for primitive in primitives {
        let indices = primitive["indices"].as_u64().expect("indices") as usize;
        assert_eq!(
            gltf["accessors"][indices]["count"], 12,
            "two quads, therefore four triangles"
        );
        assert!(
            primitive["attributes"]["TEXCOORD_0"].is_u64(),
            "the UV layer follows each primitive"
        );
        assert!(primitive["material"].is_u64(), "{primitive}");
    }
    fs::remove_dir_all(cache).expect("cleanup");
}

// Behaviour 30: the envelope changes nothing. The same file repacked as gzip
// yields, byte for byte, the same intermediate glTF as the original Zstandard.
#[test]
fn a_gzipped_file_gives_exactly_the_same_scene_as_the_zstandard_one() {
    let dir = scratch("blend", "gzip");
    let plain = unpacked();
    assert!(
        plain.starts_with(b"BLENDER"),
        "the unpacked file is a .blend"
    );
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&plain).expect("gzip");
    let gzipped = dir.join("scene.blend");
    fs::write(&gzipped, encoder.finish().expect("gzip")).expect("write");
    let raw = dir.join("brut").join("scene.blend");
    fs::create_dir_all(raw.parent().expect("dir")).expect("dir");
    fs::write(&raw, &plain).expect("write");
    let cache = scratch("blend", "gzip-cache");
    let from_gzip = fs::read(converted(&gzipped, &cache).join("model.gltf")).expect("gzip");
    let from_raw = fs::read(converted(&raw, &cache).join("model.gltf")).expect("raw");
    let from_zstd = fs::read(converted(&source(), &cache).join("model.gltf")).expect("zstd");
    assert_eq!(
        from_gzip, from_zstd,
        "gzip and Zstandard yield the same scene"
    );
    assert_eq!(from_raw, from_zstd, "a bare file yields the same scene");
    fs::remove_dir_all(dir).expect("cleanup");
    fs::remove_dir_all(cache).expect("cleanup");
}

// Behaviour 31: an image packed in the file comes out in the scene binary byte
// for byte — the PNG Blender swallowed, not a rewrite.
#[test]
fn a_packed_image_is_carried_through_byte_for_byte() {
    let cache = scratch("blend", "packed");
    let directory = converted(&source(), &cache);
    let gltf = scene_gltf(&directory);
    let bin = fs::read(directory.join("model.bin")).expect("model.bin");
    let images = gltf["images"].as_array().expect("images");
    assert_eq!(images.len(), 1, "only one image in this scene");
    assert_eq!(images[0]["mimeType"], "image/png");
    let view = images[0]["bufferView"].as_u64().expect("buffer view") as usize;
    let from = gltf["bufferViews"][view]["byteOffset"]
        .as_u64()
        .expect("offset") as usize;
    let length = gltf["bufferViews"][view]["byteLength"]
        .as_u64()
        .expect("length") as usize;
    let carried = &bin[from..from + length];
    let plain = unpacked();
    let start = find(&plain, b"\x89PNG\r\n\x1a\n").expect("the packed PNG");
    let end = find(&plain[start..], b"IEND").expect("PNG end") + start + 8;
    assert_eq!(carried, &plain[start..end], "the PNG bytes are kept");
    fs::remove_dir_all(cache).expect("cleanup");
}

/// Bytes of the fixture file once unpacked. Blender writes its Zstandard in several
/// frames, preceded by a skippable frame: the test chains them as the driver does.
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
        decoder.read_to_end(&mut out).expect("unpack");
        drop(decoder);
        rest = frame;
    }
    out
}

/// First index where `needle` appears in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
