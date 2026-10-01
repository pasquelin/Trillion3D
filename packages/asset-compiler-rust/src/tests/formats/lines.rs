use super::*;

#[test]
fn line_only_scene_keeps_geometry_without_inventing_triangle_pages() {
    for mode in [1, 2, 3] {
        let (root, mut options) = fixture();
        options.scope = "full".into();
        let mut source = read_gltf(&options);
        source["meshes"][0]["primitives"][0]["mode"] = json!(mode);
        source["accessors"][1]["count"] = json!(2);
        write_gltf(&options, &source, None);
        let result = compile(&options, |_| {}).expect("line compilation");
        let directory = options.key_directory(result["key"].as_str().unwrap());
        let tables = read_json(&directory.join("scene-tables.json"));
        let document = &tables["documents"]["source.gltf"];
        assert_eq!(document["meshes"][0]["primitives"][0]["mode"], mode);
        assert_eq!(document["accessors"][1]["count"], 2);
        assert!(paged(&directory).manifest["primitives"]
            .as_array()
            .unwrap()
            .is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn imported_lines_refuse_bad_indices_nonfinite_positions_and_incomplete_controls() {
    for fault in ["index", "position", "control"] {
        let (root, mut options) = fixture();
        options.scope = "full".into();
        let mut source = read_gltf(&options);
        source["meshes"][0]["primitives"][0]["mode"] = json!(1);
        source["accessors"][1]["count"] = json!(2);
        let mut binary = fs::read(options.source.join("mesh.bin")).unwrap();
        match fault {
            "index" => binary[40..44].copy_from_slice(&99u32.to_le_bytes()),
            "position" => binary[0..4].copy_from_slice(&f32::NAN.to_le_bytes()),
            _ => source["meshes"][0]["primitives"][0]["attributes"]["_LDRAW_CONTROL0"] = json!(0),
        }
        write_gltf(&options, &source, Some(&binary));
        assert!(compile(&options, |_| {}).is_err(), "{fault}");
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn gcode_fixture_compiles_as_three_named_line_materials() {
    let source = golden_dir("gcode").join("toolpath.gcode");
    let run = compile_golden_source(&source, "gcode-path");
    let (_, gltf) = run.prepared("gcode");
    assert_eq!(source_stats(&gltf).unwrap(), (1, 0));
    assert_eq!(gltf["meshes"][0]["primitives"].as_array().unwrap().len(), 3);
    assert_eq!(
        gltf["meshes"][0]["extras"]["moves"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(run.result["selectedTriangles"], 0);
}
#[test]
fn incomplete_line_pairs_and_single_vertex_strips_are_refused() {
    for (mode, count, indexed) in [(1, 3, true), (1, 3, false), (2, 1, true), (3, 1, true)] {
        let (root, mut options) = fixture();
        options.scope = "full".into();
        let mut source = read_gltf(&options);
        source["meshes"][0]["primitives"][0]["mode"] = json!(mode);
        if indexed {
            source["accessors"][1]["count"] = json!(count);
        } else {
            source["meshes"][0]["primitives"][0]
                .as_object_mut()
                .unwrap()
                .remove("indices");
        }
        write_gltf(&options, &source, None);
        assert!(
            compile(&options, |_| {}).is_err(),
            "mode={mode}, count={count}, indexed={indexed}"
        );
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn line_material_variants_refuse_textures_even_without_a_default_material() {
    for default in [false, true] {
        for textured in [false, true] {
            let (root, mut options) = fixture();
            options.scope = "full".into();
            let mut source = read_gltf(&options);
            source["accessors"][1]["count"] = json!(2);
            source["materials"] = json!([{}, {"pbrMetallicRoughness": {}}]);
            source["extensionsUsed"] = json!(["KHR_materials_variants"]);
            source["extensions"] = json!({"KHR_materials_variants": {
                "variants": [{"name": "alternate"}]
            }});
            let primitive = &mut source["meshes"][0]["primitives"][0];
            primitive["mode"] = json!(1);
            if default {
                primitive["material"] = json!(0);
            } else {
                primitive.as_object_mut().unwrap().remove("material");
            }
            primitive["extensions"] = json!({"KHR_materials_variants": {
                "mappings": [{"material": 1, "variants": [0]}]
            }});
            if textured {
                fs::copy(
                    golden_dir("avif").join("rgba.avif"),
                    options.source.join("rgba.avif"),
                )
                .unwrap();
                source["images"] = json!([{"uri": "rgba.avif", "mimeType": "image/avif"}]);
                source["textures"] = json!([{"source": 0}]);
                source["materials"][1]["pbrMetallicRoughness"]["baseColorTexture"] =
                    json!({"index": 0});
            }
            write_gltf(&options, &source, None);
            let result = compile(&options, |_| {});
            if textured {
                assert_eq!(result.unwrap_err().code, "UNSUPPORTED_PRIMITIVE");
            } else {
                result.expect("untextured line variant");
            }
            fs::remove_dir_all(root).unwrap();
        }
    }
}
