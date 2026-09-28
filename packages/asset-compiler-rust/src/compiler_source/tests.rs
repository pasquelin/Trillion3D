use super::*;
use crate::compiler_buffers::concat_gltf_buffers;
use crate::compiler_runtime::load_model_file;
use crate::compiler_types::Binary;
use std::fs;

use crate::tests::directories::scratch;
use crate::tests::fixtures::encode_glb as glb;

#[test]
fn mapped_glb_keeps_one_bin_slice_and_original_source_hash() {
    let g = json!({"buffers":[{"byteLength":4}],"bufferViews":[],"meshes":[],"nodes":[]});
    let source = glb(&g, &[1, 2, 3, 4]);
    let dir = scratch("glb", "map");
    fs::write(dir.join("one.glb"), &source).expect("source");
    let cancelled = std::sync::atomic::AtomicBool::new(false);
    let budget = crate::compiler_runtime::compressed::Budget {
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
    let manifest = crate::compiler_runtime::runtime_manifest("one.glb", "bad", &[], 0, 0);
    let refusal = load_model_file(&dir, "one.glb", Some((manifest, Vec::new())), &budget)
        .err()
        .expect("hash refusal");
    assert_eq!(refusal.code, "SOURCE_HASH_MISMATCH");
    fs::remove_dir_all(&dir).expect("cleanup");
}

#[test]
fn borrowed_glb_parts_preserve_owned_parser_and_length_refusal() {
    let g = json!({"buffers":[{"byteLength":4}]});
    let bytes = glb(&g, &[5, 6, 7, 8]);
    let (borrowed, range) = parse_glb_parts(&bytes).expect("borrowed parse");
    let (owned, bin) = parse_glb(&bytes).expect("owned parse");
    assert_eq!(borrowed, owned);
    assert_eq!(&bytes[range], bin.as_slice());
    let mut invalid = bytes;
    invalid[8..12].copy_from_slice(&0u32.to_le_bytes());
    assert_eq!(
        parse_glb_parts(&invalid).unwrap_err().message,
        "GLB length mismatch"
    );
    assert_eq!(
        parse_glb(&invalid).unwrap_err().message,
        "GLB length mismatch"
    );
}

#[test]
fn multiple_buffers_still_pack_and_validate_embedded_length() {
    let g = json!({"buffers":[{"byteLength":4},{"uri":"next.bin","byteLength":4}]});
    let dir = scratch("glb", "pack");
    fs::write(dir.join("next.bin"), [5, 6, 7, 8]).expect("sidecar");
    let source = glb(&g, &[1, 2, 3, 4]);
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
