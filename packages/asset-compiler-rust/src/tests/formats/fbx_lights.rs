//! Authored FBX 7400 fixture: transformed/instanced lamps, and disabled source lights.
use super::*;

fn lamps() -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    options.source = root.join("lights.fbx");
    options.scope = "full".into();
    fs::copy(golden_dir("import-fbx").join("lights.fbx"), &options.source).unwrap();
    (root, options)
}

fn close(values: &Value, expected: &[f64]) {
    let actual = values.as_array().expect("vector");
    assert_eq!(actual.len(), expected.len());
    for (value, expected) in actual.iter().zip(expected) {
        assert!(
            (value.as_f64().unwrap() - expected).abs() < 1e-9,
            "{values}"
        );
    }
}

#[test]
fn fbx_lights_preserve_world_poses_instances_units_and_spot_opening() {
    let (root, options) = lamps();
    let (result, imported) = compile_with_import_key(&options);
    let intermediate = options.cache.join("native/imports").join(imported);
    let gltf = read_json(&intermediate.join("model.gltf"));
    let defs = &gltf["extensions"]["KHR_lights_punctual"]["lights"];
    let spot = defs
        .as_array()
        .unwrap()
        .iter()
        .find(|light| light["name"] == "spot")
        .unwrap();
    // FBX/Blender's spot_size is the full opening; glTF stores its half-angle.
    assert!(
        (spot["spot"]["outerConeAngle"].as_f64().unwrap() - std::f64::consts::PI / 6.0).abs()
            < 1e-12
    );
    assert!(
        (spot["spot"]["innerConeAngle"].as_f64().unwrap() - std::f64::consts::PI / 18.0).abs()
            < 1e-12
    );
    let directory = options.key_directory(result["key"].as_str().unwrap());
    let cooked = read_json(&directory.join("lights.json"));
    let lights = cooked["lights"].as_array().unwrap();
    let find = |id: &str| lights.iter().find(|light| light["id"] == id).unwrap();
    close(&find("point")["position"], &[13.0, 22.0, 29.0]);
    close(&find("point#2")["position"], &[12.0, 20.0, 31.0]);
    close(&find("point")["color"], &[1.0, 0.5, 0.25]);
    assert!(
        (find("point")["intensity"].as_f64().unwrap()
            - 2000.0 / (4.0 * std::f64::consts::PI * 683.0))
            .abs()
            < 1e-12
    );
    close(&find("spot")["position"], &[10.0, 21.0, 30.0]);
    close(&find("spot")["direction"], &[0.0, -1.0, 0.0]);
    close(&find("sun")["direction"], &[-1.0, 0.0, 0.0]);
    assert_eq!(find("sun")["castsShadow"], false);
    assert!((find("sun")["intensity"].as_f64().unwrap() - 5000.0 / 683.0).abs() < 1e-12);
    let tables = read_json(&directory.join("scene-tables.json"));
    assert_eq!(tables["lights"].as_array().unwrap().len(), 4);
    let again = compile(&options, |_| {}).unwrap();
    assert_eq!(
        again["key"], result["key"],
        "same source keeps cache identity"
    );
    assert_eq!(read_json(&directory.join("lights.json")), cooked);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn fbx_disabled_and_hidden_lights_do_not_illuminate_the_compiled_scene() {
    let (root, options) = lamps();
    let result = compile(&options, |_| {}).unwrap();
    let directory = options.key_directory(result["key"].as_str().unwrap());
    let cooked = read_json(&directory.join("lights.json"));
    let names: Vec<_> = cooked["lights"]
        .as_array()
        .unwrap()
        .iter()
        .map(|light| light["id"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["point", "point#2", "spot", "sun"]);
    fs::remove_dir_all(root).unwrap();
}
