use super::*;
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
    assert_eq!(loaded.g_bytes, fs::read(root.join("Box.gltf")).unwrap());
    assert_eq!(loaded.manifest["runtime"]["sha256"], hash(&loaded.g_bytes));
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
    let mut g: Value = serde_json::from_slice(&fs::read(root.join("Box.gltf")).unwrap()).unwrap();
    g["buffers"][0].as_object_mut().unwrap().remove("uri");
    g["meshes"][0]["primitives"][0]["mode"] = json!(5);
    let mut json = serde_json::to_vec(&g).unwrap();
    json.resize(json.len() + crate::shared_math::pad_to_4(json.len()), b' ');
    let bin = fs::read(root.join("Box.bin")).unwrap();
    let mut glb = Vec::new();
    for word in [
        0x46546c67u32,
        2,
        (28 + json.len() + bin.len()) as u32,
        json.len() as u32,
        0x4e4f534a,
    ] {
        glb.extend_from_slice(&word.to_le_bytes());
    }
    glb.extend_from_slice(&json);
    glb.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    glb.extend_from_slice(&0x004e4942u32.to_le_bytes());
    glb.extend_from_slice(&bin);
    let (mut g, bin) = parse_glb(&glb).unwrap();
    let (binary, mut offsets, _) = concat_gltf_buffers(&root, &g, Some(&bin), None).unwrap();
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
    let mut g = json!({"buffers":[{"byteLength":1024},{"uri":"Box.bin","byteLength":120}],
        "bufferViews":[{"buffer":0,"byteLength":1024,"extensions":{MESHOPT:{"buffer":0,"byteLength":120,"byteStride":4,"count":256,"mode":"ATTRIBUTES"}}}]});
    let (binary, mut offsets, _) = concat_gltf_buffers(&root, &g, None, None).unwrap();
    assert_eq!(binary.bytes().len(), 120);
    assert_eq!(offsets[0], usize::MAX);
    let cancelled = AtomicBool::new(false);
    assert!(
        meshopt_views(
            &mut g,
            binary,
            &mut offsets,
            &Budget {
                limit: 4096,
                cancelled: &cancelled
            }
        )
        .is_err()
    );
}
