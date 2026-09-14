use super::*;

#[test]
fn compile_concatenates_multiple_buffers() {
    let (root, options) = fixture();
    let pos = fs::read(options.source.join("mesh.bin")).expect("bin");
    let (positions, indices) = (pos[..36].to_vec(), pos[36..].to_vec());
    fs::write(options.source.join("pos.bin"), &positions).expect("pos");
    fs::write(options.source.join("idx.bin"), &indices).expect("idx");
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"pos.bin","byteLength":36},{"uri":"idx.bin","byteLength":12}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},{"buffer":1,"byteOffset":0,"byteLength":12}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":3}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0},{"mesh":0}],"materials":[]});
    let gltf_bytes = serde_json::to_vec(&gltf).expect("gltf");
    fs::write(options.source.join("mesh.gltf"), &gltf_bytes).expect("write");
    let manifest = json!({"status":"ready","formatVersion":SOURCE_FORMAT_VERSION,"runtime":{"file":"mesh.gltf","sha256":hash(&gltf_bytes),"sidecars":[{"file":"pos.bin","sha256":hash(&positions)},{"file":"idx.bin","sha256":hash(&indices)}],"trianglesAcrossNodes":2,"meshNodes":2}});
    fs::write(
        options.source.join("manifest.json"),
        serde_json::to_vec(&manifest).expect("manifest"),
    )
    .expect("write");
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 1);
    let written = written_gltf(&options, result["key"].as_str().expect("key"));
    assert_eq!(written["buffers"].as_array().expect("buffers").len(), 1);
    assert_eq!(written["bufferViews"][0]["buffer"], 0);
    assert_eq!(written["bufferViews"][1]["buffer"], 0);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_slice_keeps_the_smallest_mesh_when_budget_is_below_one_instance() {
    let (root, mut options) = cube_fixture();
    options.scope = "slice".into();
    options.triangle_budget = 1;
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 12);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_sparse_accessor_overrides_base_data() {
    let (root, options) = fixture();
    let mut bin = fs::read(options.source.join("mesh.bin")).expect("read bin");
    let sparse_idx_offset = bin.len();
    bin.extend_from_slice(&1u32.to_le_bytes());
    let sparse_val_offset = bin.len();
    for v in [5.0f32, 0.0, 0.0] {
        bin.extend_from_slice(&v.to_le_bytes());
    }
    fs::write(options.source.join("mesh.bin"), &bin).expect("write bin");
    let mut gltf = read_gltf(&options);
    gltf["buffers"][0]["byteLength"] = json!(bin.len());
    let bv_idx = gltf["bufferViews"].as_array().expect("views").len();
    let bv_val = bv_idx + 1;
    gltf["bufferViews"]
        .as_array_mut()
        .expect("views")
        .push(json!({"buffer":0,"byteOffset":sparse_idx_offset,"byteLength":4}));
    gltf["bufferViews"]
        .as_array_mut()
        .expect("views")
        .push(json!({"buffer":0,"byteOffset":sparse_val_offset,"byteLength":12}));
    gltf["accessors"][0]["sparse"] = json!({"count":1,"indices":{"bufferView":bv_idx,"componentType":5125},"values":{"bufferView":bv_val}});
    write_gltf(&options, &gltf, Some(&bin));
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 1);
    let page = &result["primitives"][0]["pages"][0];
    assert_eq!(page["max"][0], 5.0);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_leaves_skinned_and_morph_meshes_unsplit() {
    let (root, options) = fixture();
    let mut bin = fs::read(options.source.join("mesh.bin")).expect("read bin");
    let target_offset = bin.len();
    for v in [0.1f32, 0.2, 0.3] {
        bin.extend_from_slice(&v.to_le_bytes());
    }
    let ibm_offset = bin.len();
    for _ in 0..16 {
        bin.extend_from_slice(&0.0f32.to_le_bytes());
    }
    fs::write(options.source.join("mesh.bin"), &bin).expect("write bin");
    let mut gltf = read_gltf(&options);
    gltf["buffers"][0]["byteLength"] = json!(bin.len());
    let bv_target = gltf["bufferViews"].as_array().expect("views").len();
    let bv_ibm = bv_target + 1;
    gltf["bufferViews"]
        .as_array_mut()
        .expect("views")
        .push(json!({"buffer":0,"byteOffset":target_offset,"byteLength":12}));
    gltf["bufferViews"]
        .as_array_mut()
        .expect("views")
        .push(json!({"buffer":0,"byteOffset":ibm_offset,"byteLength":64}));
    let acc_target = gltf["accessors"].as_array().expect("accessors").len();
    let acc_ibm = acc_target + 1;
    gltf["accessors"]
        .as_array_mut()
        .expect("accessors")
        .push(json!({"bufferView":bv_target,"componentType":5126,"type":"VEC3","count":1}));
    gltf["accessors"]
        .as_array_mut()
        .expect("accessors")
        .push(json!({"bufferView":bv_ibm,"componentType":5126,"type":"MAT4","count":1}));
    gltf["meshes"][0]["primitives"][0]["targets"] = json!([{"POSITION":acc_target}]);
    gltf["nodes"][0]["skin"] = json!(0);
    gltf["skins"] = json!([{"inverseBindMatrices":acc_ibm,"joints":[0]}]);
    write_gltf(&options, &gltf, Some(&bin));
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["primitives"][0]["pass"], "shared-blend");
    assert!(result["primitives"][0]["pages"]
        .as_array()
        .expect("pages")
        .is_empty());
    let source_gltf = written_gltf(&options, result["key"].as_str().expect("key"));
    assert!(source_gltf.get("skins").is_some());
    assert!(source_gltf["meshes"][0]["primitives"][0]
        .get("targets")
        .is_some());
    fs::remove_dir_all(root).expect("cleanup");
}
