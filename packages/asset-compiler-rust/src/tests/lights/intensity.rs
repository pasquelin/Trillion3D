//! `SceneLight.intensity`: a glTF light's candela or lux is the number the engine receives, and
//! a light that declares no range is unbounded.
use super::lamp_emitter::{lights_of, scene};
use super::*;

/// The light `scene` writes of a glTF light `declared`, on the only node that carries it.
fn written(declared: Value) -> Value {
    let node = json!({"mesh":0,"extensions":{"KHR_lights_punctual":{"light":0}}});
    let (root, options) = scene(json!({"name":"m"}), declared, json!([{"mesh":0}, node]));
    let lights = lights_of(&options);
    fs::remove_dir_all(root).expect("cleanup");
    lights["lights"][0].clone()
}

// Behaviour: a point light of 100 cd without a range keeps its 100, and its range is the distance
// unbounded, 1e20 m, as glTF defines it; a sun keeps its lux.
#[test]
fn candela_and_lux_pass_through_unchanged() {
    let point = written(json!({"type":"point","color":[1.0,1.0,1.0],"intensity":100.0}));
    assert_eq!(point["intensity"], json!(100.0));
    let range = point["range"].as_f64().expect("range");
    assert_eq!(range, 1.0e20);
    let sun = written(json!({"type":"directional","color":[1.0,1.0,1.0],"intensity":3.0}));
    assert_eq!(sun["intensity"], json!(3.0));
}
