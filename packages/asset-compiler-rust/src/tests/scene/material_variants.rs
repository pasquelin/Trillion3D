//! Hand-authored KHR_materials_variants on the existing triangle fixture; colors are the oracle.
use super::*;

#[test]
fn material_variants_preserve_default_and_alternate_bindings_in_both_documents() {
    let folder = golden_dir("gltf-material-variants");
    let document = read_json(&folder.join("variants.gltf"));
    let bin = fs::read(folder.join("variants.bin")).unwrap();
    let (_root, mut options) = gltf_fixture("variants", &document, &bin);
    options.scope = "full".into();
    let tables = super::scene_tables::tables_of(&options);
    assert_eq!(tables["materialVariants"], json!(["paint", "paint"]));
    for document in tables["documents"].as_object().unwrap().values() {
        let primitive = &document["meshes"][0]["primitives"][0];
        let materials = tables["materials"].as_array().unwrap();
        assert_eq!(
            materials[primitive["material"].as_u64().unwrap() as usize]["name"],
            "default"
        );
        let bindings = primitive["variants"].as_array().unwrap();
        assert_eq!(bindings.len(), 2);
        for (binding, expected) in bindings.iter().zip(["blue", "green"]) {
            assert_eq!(
                materials[binding["material"].as_u64().unwrap() as usize]["name"],
                expected
            );
        }
    }
}

#[test]
fn material_variants_refuse_duplicate_and_out_of_range_bindings() {
    for ids in [json!([0, 0]), json!([1]), json!([-1])] {
        let (_root, options) = fixture();
        let mut g = read_gltf(&options);
        g["materials"] = json!([{}]);
        g["extensions"]["KHR_materials_variants"] = json!({"variants":[{"name":"one"}]});
        g["meshes"][0]["primitives"][0]["extensions"]["KHR_materials_variants"] =
            json!({"mappings":[{"material":0,"variants":ids}]});
        write_gltf(&options, &g, None);
        assert!(
            compile(&options, |_| {}).is_err(),
            "invalid mapping must not publish"
        );
    }
}
