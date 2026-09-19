//! Q — `SceneLight.emitterRadius`: the radius of the envelope a light stops occluding.
//!
//! Two provenances, in this order: the radius the source declares on the light,
//! otherwise the one measured on the emissive body linked to it by graph parentage.
//! The contract (`docs/SDK.md`) wants it in metres, strictly positive, strictly
//! under the range, and never on a directional.
use super::*;

/// Punctual light of the synthetic cases, at 3 m range except when the case tightens it.
fn lampe(range: f64) -> Value {
    json!({"type":"point","color":[1.0,1.0,1.0],"intensity":1000.0,"range":range})
}
/// A material that emits, and one that does not: that is the only thing that
/// distinguishes an envelope from a wall, and the compiler looks at nothing else
/// — neither the node name, nor the mesh name.
fn emissif(yes: bool) -> Value {
    let factor = if yes { 1.0 } else { 0.0 };
    json!({"name":"m","emissiveFactor":[factor,factor,factor]})
}
/// Nodes of the current case: two instances of the fixture triangle, then the light.
fn a_cote(lamp_node: Value) -> Value {
    json!([{"mesh":0},{"mesh":0}, lamp_node])
}
/// A direct glTF source carrying this material, this light and these nodes.
/// Without a manifest, the document itself says what it contains: the case has
/// nothing to restamp.
fn scene(material: Value, light: Value, nodes: Value) -> (PathBuf, Options) {
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
fn lights_of(options: &Options) -> Value {
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
/// Expected half-diagonal of the synthetic cases: the fixture triangle carries
/// its vertices at sqrt(2)/2 from the point (0.5; 0.5; 0) where the light sits.
const DEMI_DIAGONALE: f64 = std::f64::consts::SQRT_2 / 2.0;
fn lampe_a_cote() -> Value {
    json!({"name":"lampe","translation":[0.5,0.5,0.0],"extensions":{"KHR_lights_punctual":{"light":0}}})
}

// Behaviour: a direct sibling whose material emits is the light's envelope; its
// radius is the greatest distance from the centre to one of its vertices, and
// provenance is counted.
#[test]
fn an_emissive_sibling_gives_the_envelope_radius() {
    let (root, options) = scene(emissif(true), lampe(3.0), a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert!(
        (radius.expect("radius") - DEMI_DIAGONALE).abs() < 1e-12,
        "{radius:?}"
    );
    assert_eq!(counts["light-emitter-radius-derived"], json!(1));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: the parent node's mesh makes an envelope just as a sibling does.
#[test]
fn the_parent_mesh_makes_an_envelope() {
    let lamp = json!({"name":"lampe","extensions":{"KHR_lights_punctual":{"light":0}}});
    let nodes = json!([{"mesh":0,"children":[2]},{"mesh":0}, lamp]);
    let (root, options) = scene(emissif(true), lampe(3.0), nodes);
    let (radius, counts) = radius_and_counts(&options);
    assert!((radius.expect("radius") - 1.0).abs() < 1e-12, "{radius:?}");
    assert_eq!(counts["light-emitter-radius-derived"], json!(1));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: without an emissive body around it, the light declares no radius
// and nothing is counted — the product is word for word that of before this lot.
#[test]
fn without_an_emissive_body_the_field_stays_absent() {
    let (root, options) = scene(emissif(false), lampe(3.0), a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, None);
    assert_eq!(counts, json!({}));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: the radius the source declares on the light comes before any
// measurement, and is not counted as derived — it does not come from the scene,
// it comes from the file.
#[test]
fn the_source_declared_radius_wins_over_the_envelope() {
    let mut light = lampe(3.0);
    light["extras"] = json!({"emitterRadius":0.25});
    let (root, options) = scene(emissif(true), light, a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, Some(0.25));
    assert_eq!(counts, json!({}));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a directional has no centre; the contract refuses it the field,
// even surrounded by an emissive body, and nothing is counted since nothing was tried.
#[test]
fn a_directional_never_receives_a_radius() {
    let mut light = lampe(3.0);
    light["type"] = json!("directional");
    let (root, options) = scene(emissif(true), light, a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, None);
    assert_eq!(counts, json!({}));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: an envelope as wide as the range is no longer one. The radius is
// counted under its code and the field stays absent, rather than excluding
// beyond what it contains.
#[test]
fn a_radius_beyond_the_range_is_counted_and_omitted() {
    let (root, options) = scene(emissif(true), lampe(0.5), a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, None);
    assert_eq!(counts["light-emitter-radius-invalid"], json!(1));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: the fixture shipped with the package yields the radius its README
// announces — 0.20 m, the distance from the light centre to the vertices of its
// emissive envelope — without any retouch.
#[test]
fn the_emetteur_sphere_fixture_yields_its_radius() {
    let run = compile_golden(&golden_dir("classes-materiaux"), "emetteur-sphere");
    let key = run.result["key"].as_str().expect("key");
    let lights = read_json(&run.cache.join("native/full").join(key).join("lights.json"));
    let radius = lights["lights"][0]["emitterRadius"]
        .as_f64()
        .expect("radius");
    assert!((radius - 0.2).abs() < 1e-6, "{radius}");
    assert_eq!(lights["counts"]["light-emitter-radius-derived"], json!(1));
}
