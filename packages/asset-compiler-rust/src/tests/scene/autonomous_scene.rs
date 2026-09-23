//! A08: availability contract of the autonomous scene. The cache announced
//! `autonomousScene` as soon as all its primitives were exact, then wrote a
//! `scene.gltf` whose animations had vanished: the consumer chose that mode and
//! lost motion without a word. A node animation is neither skinning nor morphing,
//! nothing in the passes betrayed it.
use super::*;

/// Both arrays carried by the base fixture: nine position floats, three indices.
const BASE_BYTES: usize = 48;

/// Compiles the fixture, animated or not, and returns the compilation result and
/// the autonomous glTF when it was written.
fn compile_scene(tag: &str, animated: bool) -> (Value, Option<Value>) {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    let mut bin = fs::read(options.source.join("mesh.bin")).expect("mesh.bin");
    if animated {
        for value in [0f32, 1.] {
            bin.extend_from_slice(&value.to_le_bytes());
        }
        for value in [0f32, 0., 0., 0., 2., 0.] {
            bin.extend_from_slice(&value.to_le_bytes());
        }
        gltf["buffers"][0]["byteLength"] = json!(bin.len());
        let views = gltf["bufferViews"].as_array_mut().expect("bufferViews");
        views.push(json!({"buffer":0,"byteOffset":BASE_BYTES,"byteLength":8}));
        views.push(json!({"buffer":0,"byteOffset":BASE_BYTES + 8,"byteLength":24}));
        let accessors = gltf["accessors"].as_array_mut().expect("accessors");
        accessors
            .push(json!({"bufferView":2,"componentType":5126,"type":"SCALAR","count":2,"min":[0.0],"max":[1.0]}));
        accessors.push(json!({"bufferView":3,"componentType":5126,"type":"VEC3","count":2}));
        gltf["animations"] = json!([{
            "name": "Glisse",
            "channels": [{"sampler":0,"target":{"node":0,"path":"translation"}}],
            "samplers": [{"input":2,"output":3,"interpolation":"LINEAR"}],
        }]);
        fs::write(options.source.join("mesh.bin"), &bin).expect("mesh.bin");
    }
    write_gltf(&options, &gltf, Some(&bin));
    let result = compile(&options, |_| {}).unwrap_or_else(|error| panic!("{tag}: {error}"));
    let key = result["key"].as_str().expect("key");
    let scene = options
        .cache
        .join("native")
        .join(&options.scope)
        .join(key)
        .join("scene.gltf");
    let written = scene.exists().then(|| read_json(&scene));
    let _ = fs::remove_dir_all(&root);
    (result, written)
}

// Finding A08: a scene that carries a node animation is either rendered with its
// animation, or declared out of autonomous mode under a named reason. What is
// announced available must be.
#[test]
fn an_animated_scene_cannot_be_announced_autonomous_then_frozen() {
    let (result, scene) = compile_scene("animee", true);
    let carried = scene
        .as_ref()
        .and_then(|scene| scene.get("animations"))
        .and_then(Value::as_array)
        .is_some_and(|animations| !animations.is_empty());
    if !carried {
        assert_eq!(
            result["autonomousScene"],
            Value::Null,
            "without its animation, the autonomous scene must not be announced"
        );
        assert!(
            result["unsupported"]
                .as_array()
                .expect("unsupported")
                .contains(&json!("autonomous-scene-animated")),
            "the refused mode is counted by name: {}",
            result["unsupported"]
        );
    }
}

// The other end: a scene without animation keeps its autonomous mode, and nothing is counted.
#[test]
fn a_scene_without_animation_keeps_its_autonomous_scene() {
    let (result, scene) = compile_scene("figee", false);
    assert_eq!(result["autonomousScene"], json!("scene.gltf"));
    assert!(scene.is_some(), "the autonomous glTF is written");
    assert!(
        !result["unsupported"]
            .as_array()
            .expect("unsupported")
            .contains(&json!("autonomous-scene-animated")),
        "nothing to count when nothing is lost"
    );
}
