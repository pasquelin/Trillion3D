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
