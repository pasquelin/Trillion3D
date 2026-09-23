use super::*;

#[test]
fn compile_omits_images_when_the_gltf_has_none() {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf.as_object_mut().expect("object").remove("images");
    write_gltf(&options, &gltf, None);
    let result = compile(&options, |_| {}).expect("compile");
    let written = written_gltf(&options, result["key"].as_str().expect("key"));
    assert!(
        written.get("images").is_none()
            || written["images"]
                .as_array()
                .map(|a| a.is_empty())
                .unwrap_or(false)
    );
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_keeps_buffer_view_images_without_uri() {
    let (root, options) = fixture();
    let mut bin = fs::read(options.source.join("mesh.bin")).expect("bin");
    let image_offset = bin.len();
    bin.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);
    fs::write(options.source.join("mesh.bin"), &bin).expect("bin write");
    let mut gltf = read_gltf(&options);
    gltf["buffers"][0]["byteLength"] = json!(bin.len());
    gltf["bufferViews"]
        .as_array_mut()
        .expect("views")
        .push(json!({"buffer":0,"byteOffset":image_offset,"byteLength":8}));
    gltf["images"] = json!([{"bufferView":2,"mimeType":"image/png"}]);
    write_gltf(&options, &gltf, Some(&bin));
    let result = compile(&options, |_| {}).expect("compile");
    let written = written_gltf(&options, result["key"].as_str().expect("key"));
    assert!(written["images"][0].get("uri").is_none());
    assert_eq!(written["images"][0]["bufferView"], 2);
    assert_eq!(written["images"][0]["mimeType"], "image/png");
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_without_manifest_discovers_the_gltf() {
    let (root, options) = fixture();
    fs::remove_file(options.source.join("manifest.json")).expect("manifest");
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 1);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_accepts_a_gltf_file_path() {
    let (root, mut options) = fixture();
    fs::remove_file(options.source.join("manifest.json")).expect("manifest");
    options.source = options.source.join("mesh.gltf");
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 1);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_accepts_glb_without_manifest() {
    let (root, options) = fixture();
    let mut gltf: Value =
        serde_json::from_slice(&fs::read(options.source.join("mesh.gltf")).expect("read"))
            .expect("json");
    let bin = fs::read(options.source.join("mesh.bin")).expect("bin");
    gltf["buffers"][0]
        .as_object_mut()
        .expect("buffer")
        .remove("uri");
    gltf["buffers"][0]["byteLength"] = json!(bin.len());
    let glb = encode_glb(&gltf, &bin);
    fs::remove_dir_all(&options.source).expect("clear");
    fs::create_dir_all(&options.source).expect("source");
    fs::write(options.source.join("mesh.glb"), &glb).expect("glb");
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["selectedTriangles"], 1);
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_leaves_transmission_unsplit() {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["materials"] = json!([{"alphaMode":"BLEND","extensions":{"KHR_materials_transmission":{"transmissionFactor":1.0},"KHR_materials_volume":{"thicknessFactor":0.02}}}]);
    gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    write_gltf(&options, &gltf, None);
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["primitives"][0]["pass"], "shared-blend");
    assert!(result["primitives"][0]["pages"]
        .as_array()
        .expect("pages")
        .is_empty());
    // No page, no grid: the primitive claims no quantization.
    assert!(result["primitives"][0]["quantization"].is_null());
    fs::remove_dir_all(root).expect("cleanup");
}
/// The four material classes and how each is ranked. Transmission enters through
/// the same door as skin — a one-piece primitive, outside the DAG — and its
/// arrival displaces none of the other three: opaque and cutout stay exact
/// clusters, blend stays clustered. Nothing is read but material properties.
#[test]
fn compile_ranks_every_material_class_by_its_own_property() {
    for (material, pass, paged) in [
        (json!({}), "exact-clusters", true),
        (
            json!({"alphaMode":"MASK","alphaCutoff":0.5}),
            "exact-clusters",
            true,
        ),
        (json!({"alphaMode":"BLEND"}), "clustered-blend", true),
        (
            json!({"alphaMode":"BLEND","extensions":{"KHR_materials_transmission":{"transmissionFactor":0.6}}}),
            "shared-blend",
            false,
        ),
    ] {
        let (root, options) = fixture();
        let mut gltf = read_gltf(&options);
        gltf["materials"] = json!([material]);
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
        write_gltf(&options, &gltf, None);
        let result = compile(&options, |_| {}).expect("compile");
        assert_eq!(result["primitives"][0]["pass"], pass, "classe {material}");
        assert_eq!(
            !result["primitives"][0]["pages"]
                .as_array()
                .expect("pages")
                .is_empty(),
            paged,
            "pages of class {material}"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
/// A zero transmission is not a transmission: the material falls back to its alphaMode class.
#[test]
fn compile_ranks_a_zero_transmission_by_its_alpha_mode() {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["materials"] = json!([{"alphaMode":"BLEND","extensions":{"KHR_materials_transmission":{"transmissionFactor":0.0}}}]);
    gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    write_gltf(&options, &gltf, None);
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(result["primitives"][0]["pass"], "clustered-blend");
    fs::remove_dir_all(root).expect("cleanup");
}
#[test]
fn compile_opaque_source_emits_the_base_cache_and_blend_the_next_format() {
    let (root, options) = fixture();
    let opaque = compile(&options, |_| {}).expect("opaque compile");
    assert_eq!(opaque["formatVersion"], json!(FORMAT_VERSION));
    let manifest_path = options.source.join("manifest.json");
    assert_eq!(
        read_json(&manifest_path)["formatVersion"],
        json!(SOURCE_FORMAT_VERSION)
    );
    let mut gltf = read_gltf(&options);
    gltf["materials"] = json!([{"alphaMode":"BLEND"}]);
    gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    let source_manifest = write_gltf(&options, &gltf, None);
    let blend = compile(&options, |_| {}).expect("blend compile");
    assert_eq!(blend["schema"], json!(CLUSTERED_BLEND_FORMAT_VERSION));
    assert_eq!(
        blend["formatVersion"],
        json!(CLUSTERED_BLEND_FORMAT_VERSION)
    );
    let pointer: Value = serde_json::from_slice(
        &fs::read(options.cache.join("native/slice/manifest.json")).expect("pointer"),
    )
    .expect("json");
    assert_eq!(
        pointer["formatVersion"],
        json!(CLUSTERED_BLEND_FORMAT_VERSION)
    );
    assert_eq!(
        fs::read(&manifest_path).expect("unchanged source"),
        source_manifest
    );
    fs::remove_dir_all(root).expect("cleanup");
}
