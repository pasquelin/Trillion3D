//! Q — `SceneLight.emitterRadius`: the radius of the envelope a light stops occluding.
//!
//! The radius is the one the source declares on the light, and no other.
//! The contract (`docs/SDK.md`) wants it in metres, strictly positive, strictly
//! under the range, and never on a directional.
use super::*;

/// Punctual light of the synthetic cases, at 3 m range except when the case tightens it.
fn point_lamp(range: f64) -> Value {
    json!({"type":"point","color":[1.0,1.0,1.0],"intensity":1000.0,"range":range})
}
/// A material that emits, and one that does not: neither changes the light.
fn emissive(yes: bool) -> Value {
    let factor = if yes { 1.0 } else { 0.0 };
    json!({"name":"m","emissiveFactor":[factor,factor,factor]})
}
/// Nodes of the current case: two instances of the fixture triangle, then the light.
fn beside(lamp_node: Value) -> Value {
    json!([{"mesh":0},{"mesh":0}, lamp_node])
}
/// A direct glTF source carrying this material, this light and these nodes.
/// Without a manifest, the document itself says what it contains: the case has
/// nothing to restamp.
pub(super) fn scene(material: Value, light: Value, nodes: Value) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["materials"] = json!([material]);
    gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    gltf["nodes"] = nodes;
    gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":[light]}});
    gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
    write_gltf(&options, &gltf, None);
    fs::remove_file(options.source.join("manifest.json")).expect("direct source");
    options.scope = "full".into();
    (root, options)
}
/// The `lights.json` product of a compilation, as a host will read it.
pub(super) fn lights_of(options: &Options) -> Value {
    let result = compile(options, |_| {}).expect("compile");
    let directory = options
        .cache
        .join("native/full")
        .join(result["key"].as_str().expect("key"));
    read_json(&directory.join("lights.json"))
}
/// Radius written on the first light, and the codes the stage counted.
fn radius_and_counts(options: &Options) -> (Option<f64>, Value) {
    let lights = lights_of(options);
    assert_eq!(lights["count"], json!(1), "one light expected: {lights}");
    (
        lights["lights"][0]
            .get("emitterRadius")
            .and_then(Value::as_f64),
        lights["counts"].clone(),
    )
}
fn lamp_node_beside() -> Value {
    json!({"name":"lampe","translation":[0.5,0.5,0.0],"extensions":{"KHR_lights_punctual":{"light":0}}})
}

// Behaviour: a light that declares no radius carries none, whatever emissive body sits beside or
// above it: nothing is measured, nothing is counted.
#[test]
fn a_light_declaring_no_radius_carries_none() {
    let lamp = json!({"name":"lampe","extensions":{"KHR_lights_punctual":{"light":0}}});
    let nodes = json!([{"mesh":0,"children":[2]},{"mesh":0}, lamp]);
    for (material, nodes) in [
        (emissive(false), beside(lamp_node_beside())),
        (emissive(true), beside(lamp_node_beside())),
        (emissive(true), nodes),
    ] {
        let (root, options) = scene(material, point_lamp(3.0), nodes);
        let (radius, counts) = radius_and_counts(&options);
        assert_eq!(radius, None);
        assert_eq!(counts, json!({}));
        fs::remove_dir_all(root).expect("cleanup");
    }
}

// Behaviour: the radius the source declares on the light is written as it is, and counts nothing.
#[test]
fn the_source_declared_radius_is_written() {
    let mut light = point_lamp(3.0);
    light["extras"] = json!({"emitterRadius":0.25});
    let (root, options) = scene(emissive(true), light, beside(lamp_node_beside()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, Some(0.25));
    assert_eq!(counts, json!({}));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a directional has no centre; the contract refuses it the field,
// even when the source declares one, and nothing is counted since nothing was tried.
#[test]
fn a_directional_never_receives_a_radius() {
    let mut light = point_lamp(3.0);
    light["type"] = json!("directional");
    light["extras"] = json!({"emitterRadius":0.25});
    let (root, options) = scene(emissive(true), light, beside(lamp_node_beside()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, None);
    assert_eq!(counts, json!({}));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a declared radius as wide as the range is not an envelope. The radius is
// counted under its code and the field stays absent, rather than excluding
// beyond what it contains.
#[test]
fn a_radius_beyond_the_range_is_counted_and_omitted() {
    let mut light = point_lamp(0.5);
    light["extras"] = json!({"emitterRadius":0.5});
    let (root, options) = scene(emissive(true), light, beside(lamp_node_beside()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, None);
    assert_eq!(counts["light-emitter-radius-invalid"], json!(1));
    fs::remove_dir_all(root).expect("cleanup");
}

// A lamp a hidden node hides (`KHR_node_visibility`) is off: it is not in `lights.json`.
#[test]
fn a_lamp_under_a_hidden_node_is_off() {
    for (visible, count) in [(true, 1), (false, 0)] {
        let group =
            json!({"children":[3],"extensions":{"KHR_node_visibility":{"visible":visible}}});
        let nodes = json!([{"mesh":0},{"mesh":0}, group, lamp_node_beside()]);
        let (_root, options) = scene(emissive(false), point_lamp(3.0), nodes);
        assert_eq!(
            lights_of(&options)["count"],
            json!(count),
            "visible {visible}"
        );
    }
}

// Behaviour: a sun's `extras.shadowDistance` travels in its light, as the contract reads it: a finite
// number of metres of at least 0 as it is, `false` as 0 (none), `true` and `null` as nothing (the
// default); another value is counted under its code and omitted, the light kept; a light that is no
// sun carries none, and nothing is counted since nothing was tried.
#[test]
fn a_suns_shadow_distance_travels_in_its_light() {
    let light_with = |kind: &str, extras: Value| {
        let mut light = json!({"type":kind,"color":[1.0,1.0,1.0],"intensity":1000.0,"range":3.0});
        light["extras"] = extras;
        let lamp = json!({"name":"lamp","extensions":{"KHR_lights_punctual":{"light":0}}});
        let (root, options) = scene(emissive(false), light, json!([{"mesh":0}, lamp]));
        let lights = lights_of(&options);
        fs::remove_dir_all(root).expect("cleanup");
        (
            lights["lights"][0].get("shadowDistance").cloned(),
            lights["counts"].clone(),
        )
    };
    let sun = |extras: Value| light_with("directional", extras);
    assert_eq!(sun(json!({"shadowDistance": 250.0})).0, Some(json!(250.0)));
    assert_eq!(sun(json!({"shadowDistance": 0.0})).0, Some(json!(0.0)));
    assert_eq!(sun(json!({"shadowDistance": false})).0, Some(json!(0.0)));
    let silent = [
        json!({"shadowDistance": true}),
        json!({"shadowDistance": null}),
        json!({}),
    ];
    for named in silent {
        let (distance, counts) = sun(named);
        assert_eq!(distance, None);
        assert_eq!(counts, json!({}));
    }
    for bad in [json!(-5.0), json!("far")] {
        let (distance, counts) = sun(json!({ "shadowDistance": bad }));
        assert_eq!(distance, None);
        assert_eq!(counts["light-shadow-distance-invalid"], json!(1));
    }
    let (distance, counts) = light_with("point", json!({"shadowDistance": 90.0}));
    assert_eq!(distance, None);
    assert_eq!(counts, json!({}));
}
