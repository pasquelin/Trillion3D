use super::*;
use crate::compiler::source::buffers::concat_gltf_buffers;
use crate::compiler::source::load::load_model_file;
use crate::compiler::source::mapped::Binary;
use std::fs;

use crate::tests::directories::scratch;
use crate::tests::fixtures::encode_glb;

#[test]
fn mapped_glb_keeps_one_bin_slice_and_original_source_hash() {
    let g = json!({"buffers":[{"byteLength":4}],"bufferViews":[],"meshes":[],"nodes":[]});
    let source = encode_glb(&g, &[1, 2, 3, 4]);
    let dir = scratch("glb", "map");
    fs::write(dir.join("one.glb"), &source).expect("source");
    let cancelled = std::sync::atomic::AtomicBool::new(false);
    let budget = crate::compiler::source::load::compressed::Budget {
        limit: 1 << 20,
        cancelled: &cancelled,
    };
    let loaded = load_model_file(&dir, "one.glb", None, &budget).expect("load GLB");
    assert!(matches!(&loaded.binary, Binary::MappedRange(..)));
    assert_eq!(loaded.binary.bytes(), &[1, 2, 3, 4]);
    // The BIN chunk is the job's binary: only the header and JSON count as glTF bytes.
    assert_eq!(loaded.g_bytes_len, source.len() - 4);
    assert_eq!(loaded.manifest["runtime"]["sha256"], json!(hash(&source)));
    assert_eq!(loaded.bin_hash, hash(&[1, 2, 3, 4]));
    drop(loaded);
    let manifest = crate::compiler::source::load::runtime_manifest("one.glb", "bad", &[], 0, 0);
    let refusal = load_model_file(&dir, "one.glb", Some(manifest), &budget)
        .err()
        .expect("hash refusal");
    assert_eq!(refusal.code, "SOURCE_HASH_MISMATCH");
    fs::remove_dir_all(&dir).expect("cleanup");
}

#[test]
fn glb_parts_locate_the_bin_and_refuse_a_wrong_length() {
    let g = json!({"buffers":[{"byteLength":4}]});
    let bytes = encode_glb(&g, &[5, 6, 7, 8]);
    let (parsed, range) = parse_glb_parts(&bytes).expect("parse");
    assert_eq!(parsed, g);
    assert_eq!(&bytes[range], &[5, 6, 7, 8]);
    let mut invalid = bytes;
    invalid[8..12].copy_from_slice(&0u32.to_le_bytes());
    assert_eq!(
        parse_glb_parts(&invalid).unwrap_err().message,
        "GLB length mismatch"
    );
}

#[test]
fn multiple_buffers_still_pack_and_validate_embedded_length() {
    let g = json!({"buffers":[{"byteLength":4},{"uri":"next.bin","byteLength":4}]});
    let dir = scratch("glb", "pack");
    fs::write(dir.join("next.bin"), [5, 6, 7, 8]).expect("sidecar");
    let source = encode_glb(&g, &[1, 2, 3, 4]);
    fs::write(dir.join("many.glb"), &source).expect("source");
    let map = map_source(&dir.join("many.glb")).expect("map");
    let (_, range) = parse_glb_parts(&map).expect("parse");
    let (binary, offsets, sidecars) =
        concat_gltf_buffers(&dir, &g, Some(Binary::MappedRange(map, range)), None).expect("pack");
    assert!(matches!(&binary, Binary::Owned(..)));
    assert_eq!(binary.bytes(), &[1, 2, 3, 4, 5, 6, 7, 8]);
    assert_eq!(offsets, vec![0, 4]);
    assert_eq!(
        sidecars,
        vec![("next.bin".to_string(), hash(&[5, 6, 7, 8]))]
    );
    let short = json!({"buffers":[{"byteLength":5}]});
    let refusal = concat_gltf_buffers(&dir, &short, Some(Binary::Owned(vec![1, 2, 3, 4])), None)
        .err()
        .expect("length refusal");
    assert_eq!(
        refusal.message,
        "glTF buffer byteLength exceeds source bytes"
    );
    fs::remove_dir_all(&dir).expect("cleanup");
}

// Behaviour: a buffer is a base64 `data:` URI of the length it declares, or a relative path in a
// sub-folder, `%XX` escaped; a wrong length, mime, encoding or an escaping path is refused.
#[test]
fn a_buffer_is_a_data_uri_or_a_path_in_a_sub_folder() {
    let dir = scratch("glb", "uris");
    fs::create_dir_all(dir.join("buffers")).expect("folder");
    fs::write(dir.join("buffers/a b.bin"), [9, 8, 7, 6]).expect("sidecar");
    let data = |uri: &str, len: usize| json!({"buffers":[{"uri":uri,"byteLength":len}]});
    let read = |g: &Value| concat_gltf_buffers(&dir, g, None, None);
    let (binary, _, sidecars) =
        read(&data("data:application/octet-stream;base64,AQIDBAU=", 5)).expect("data");
    assert_eq!(binary.bytes(), &[1, 2, 3, 4, 5]);
    assert!(sidecars.is_empty());
    let (binary, _, sidecars) = read(&data("buffers/a%20b.bin", 4)).expect("sub-folder");
    assert_eq!(binary.bytes(), &[9, 8, 7, 6]);
    assert_eq!(sidecars[0].0, "buffers/a b.bin");
    for refused in [
        data("data:application/octet-stream;base64,AQIDBAU=", 4),
        data("data:text/plain;base64,AQIDBAU=", 5),
        data("data:application/octet-stream,AQIDBAU=", 5),
        data("data:application/octet-stream;base64,A*IDBAU=", 5),
        data("../a.bin", 4),
        data("buffers/../../a.bin", 4),
        data("/etc/a.bin", 4),
    ] {
        assert!(read(&refused).is_err(), "{refused}");
    }
    fs::remove_dir_all(&dir).expect("cleanup");
}

// Behaviour: a binary made growable keeps its bytes and has the room a pass asked for — a mapped
// one copied once with it, an owned one grown in place — so that appending what was asked
// reallocates nothing.
#[test]
fn a_binary_made_growable_has_the_room_asked_for() {
    let dir = scratch("glb", "grow");
    fs::write(dir.join("bytes.bin"), [1u8, 2, 3, 4]).expect("bytes");
    let mapped = Binary::Mapped(map_source(&dir.join("bytes.bin")).expect("map"));
    let mut grown = mapped.into_owned(100).expect("copy");
    assert_eq!(grown, [1, 2, 3, 4]);
    assert!(grown.capacity() >= 104);
    let room = grown.capacity();
    grown.extend([0u8; 100]);
    assert_eq!(grown.capacity(), room, "the room asked for was enough");
    let mut owned = Binary::Owned(vec![9, 8, 7]).into_owned(50).expect("grown");
    assert_eq!(owned, [9, 8, 7]);
    assert!(owned.capacity() >= 53);
    owned.clear();
    fs::remove_dir_all(&dir).expect("cleanup");
}

// Behaviour: a document requiring an extension no reader implements, or of a version above 2.x, is
// refused by name; one that only uses such an extension loads and counts it in the import report.
#[test]
fn a_required_extension_nobody_reads_refuses_the_document() {
    let dir = scratch("gltf", "required");
    let cancelled = std::sync::atomic::AtomicBool::new(false);
    let budget = crate::compiler::source::load::compressed::Budget {
        limit: 1 << 20,
        cancelled: &cancelled,
    };
    let base = json!({
        "asset":{"version":"2.0"},
        "buffers":[{"byteLength":4,"uri":"data:application/octet-stream;base64,AQIDBA=="}],
        "bufferViews":[],"meshes":[],"nodes":[],
    });
    let load = |g: &Value| {
        fs::write(dir.join("a.gltf"), serde_json::to_vec(g).expect("json")).expect("source");
        load_model_file(&dir, "a.gltf", None, &budget)
    };
    let mut required = base.clone();
    required["extensionsRequired"] = json!(["KHR_materials_unlit", "KHR_materials_variants"]);
    let refusal = load(&required).err().expect("refusal");
    assert_eq!(refusal.code, "UNSUPPORTED_EXTENSION");
    assert!(
        refusal.message.ends_with("KHR_materials_variants)"),
        "{}",
        refusal.message
    );
    let mut newer = base.clone();
    newer["asset"] = json!({"version":"3.0","minVersion":"3.0"});
    assert_eq!(
        load(&newer).err().expect("refusal").code,
        "UNSUPPORTED_VERSION"
    );
    let mut used = base.clone();
    used["extensionsUsed"] = json!(["KHR_materials_unlit", "KHR_materials_variants"]);
    let loaded = load(&used).expect("load");
    assert_eq!(
        loaded.manifest["unsupported"]["extension-not-implemented"],
        json!(1)
    );
    assert_eq!(loaded.binary.bytes(), &[1, 2, 3, 4]);
    fs::remove_dir_all(&dir).expect("cleanup");
}
