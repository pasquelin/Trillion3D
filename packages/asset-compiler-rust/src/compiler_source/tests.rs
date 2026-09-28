use super::*;
use crate::compiler_buffers::concat_gltf_buffers;
use crate::compiler_runtime::load_model_file;
use crate::compiler_types::Binary;
use std::fs;

fn glb(g: &Value, bin: &[u8]) -> Vec<u8> {
    let mut json = serde_json::to_vec(g).expect("JSON");
    let padded_len = crate::shared_math::pad_to_4(json.len()) + json.len();
    json.resize(padded_len, b' ');
    let len = 12 + 8 + json.len() + 8 + bin.len();
    let mut out = Vec::with_capacity(len);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(len as u32).to_le_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x4E4F_534Au32.to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x004E_4942u32.to_le_bytes());
    out.extend_from_slice(bin);
    out
}

#[test]
fn mapped_glb_keeps_one_bin_slice_and_original_source_hash() {
    let g = json!({"buffers":[{"byteLength":4}],"bufferViews":[],"nodes":[]});
    let source = glb(&g, &[1, 2, 3, 4]);
    let dir = std::env::temp_dir().join(format!("trillion3d-glb-map-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("directory");
    fs::write(dir.join("one.glb"), &source).expect("source");
    let loaded = load_model_file(&dir, "one.glb", None).expect("load GLB");
    assert!(matches!(&loaded.binary, Binary::MappedRange(..)));
    assert_eq!(loaded.binary.bytes(), &[1, 2, 3, 4]);
    assert_eq!(loaded.g_bytes_len, source.len());
    assert_eq!(loaded.manifest["runtime"]["sha256"], json!(hash(&source)));
    assert_eq!(loaded.bin_hash, hash(&[1, 2, 3, 4]));
    drop(loaded);
    let manifest = crate::compiler_runtime::runtime_manifest("one.glb", "bad", &[], 0, 0);
    let refusal = load_model_file(&dir, "one.glb", Some((manifest, Vec::new())))
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
    let dir = std::env::temp_dir().join(format!("trillion3d-glb-pack-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("directory");
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
