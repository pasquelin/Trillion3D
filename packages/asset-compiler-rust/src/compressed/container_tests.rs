use super::*;
use crate::tests::fixtures::{encode_glb, read_json};
fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/formats/gltf/compressed-box")
}
#[test]
fn external_gltf_load_retains_provenance_and_original_bytes() {
    let root = fixture();
    let cancelled = AtomicBool::new(false);
    let loaded = load_model_file(
        &root,
        "Box.gltf",
        None,
        &Budget {
            limit: 16 * 1024 * 1024,
            cancelled: &cancelled,
        },
    )
    .unwrap();
    let source = fs::read(root.join("Box.gltf")).unwrap();
    assert_eq!(loaded.g_bytes_len, source.len());
    assert_eq!(loaded.manifest["runtime"]["sha256"], hash(&source));
    assert_eq!(
        loaded.manifest["runtime"]["sidecars"][0]["sha256"],
        hash(&fs::read(root.join("Box.bin")).unwrap())
    );
    assert_eq!(loaded.manifest["runtime"]["trianglesAcrossNodes"], 12);
    assert_eq!(loaded.bin_hash, hash(loaded.binary.bytes()));
}
#[test]
fn embedded_glb_and_triangle_strip_normalize_to_triangles() {
    let root = fixture();
    let mut g = read_json(&root.join("Box.gltf"));
    g["buffers"][0].as_object_mut().unwrap().remove("uri");
    g["meshes"][0]["primitives"][0]["mode"] = json!(5);
    let glb = encode_glb(&g, &fs::read(root.join("Box.bin")).unwrap());
    let (mut g, range) = parse_glb_parts(&glb).unwrap();
    let bin = glb[range].to_vec();
    let (binary, mut offsets, _) =
        concat_gltf_buffers(&root, &g, Some(Binary::Owned(bin)), None).unwrap();
    let cancelled = AtomicBool::new(false);
    let budget = Budget {
        limit: 16 * 1024 * 1024,
        cancelled: &cancelled,
    };
    let binary = meshopt_views(&mut g, binary, &mut offsets, &budget).unwrap();
    flatten_buffer_views(&mut g, &offsets, binary.bytes().len()).unwrap();
    let binary = draco_primitives(&mut g, binary, &budget).unwrap();
    let primitive = &g["meshes"][0]["primitives"][0];
    assert_eq!(primitive["mode"], 4);
    let indices = accessor(
        &g,
        binary.bytes(),
        primitive["indices"].as_u64().unwrap() as usize,
        None,
    )
    .unwrap();
    assert_eq!(indices.count, 36);
}
#[test]
fn absent_meshopt_fallback_is_not_allocated_or_usable_as_source() {
    let root = fixture();
    let mut g = json!({"extensionsRequired":[MESHOPT],
        "buffers":[{"byteLength":1024},{"uri":"Box.bin","byteLength":120}],
        "bufferViews":[{"buffer":0,"byteLength":1024,"extensions":{MESHOPT:{"buffer":0,"byteLength":120,"byteStride":4,"count":256,"mode":"ATTRIBUTES"}}}]});
    let (binary, mut offsets, _) = concat_gltf_buffers(&root, &g, None, None).unwrap();
    assert_eq!(binary.bytes().len(), 120);
    assert_eq!(offsets[0], usize::MAX);
    let cancelled = AtomicBool::new(false);
    assert!(meshopt_views(
        &mut g,
        binary,
        &mut offsets,
        &Budget {
            limit: 4096,
            cancelled: &cancelled
        }
    )
    .is_err());
}

#[test]
fn absent_meshopt_fallback_requires_the_extension() {
    let root = fixture();
    let g = json!({"buffers":[{"byteLength":1024},{"uri":"Box.bin","byteLength":120}],
        "bufferViews":[{"buffer":0,"byteLength":1024,"extensions":{MESHOPT:{"buffer":1,"byteLength":120,"byteStride":4,"count":256,"mode":"ATTRIBUTES"}}}]});
    assert!(!placeholder(&g, 0));
    assert!(concat_gltf_buffers(&root, &g, None, None).is_err());
}
