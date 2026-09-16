//! A08 : le contrat de disponibilité de la scène autonome. Le cache annonçait `autonomousScene`
//! dès que toutes ses primitives étaient exactes, puis écrivait un `scene.gltf` dont les animations
//! avaient disparu : le consommateur choisissait ce mode et perdait le mouvement sans un mot. Une
//! animation de nœud n'est ni du skinning ni du morphing, rien dans les passes ne la trahissait.
use super::*;

/// Les deux tableaux que la fixture de base porte : neuf flottants de position, trois indices.
const BASE_BYTES: usize = 48;

/// Compile la fixture, animée ou non, et rend le résultat de la compilation et le glTF autonome
/// quand il a été écrit.
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

// Constat A08 : une scène qui porte une animation de nœud est soit rendue avec son animation, soit
// déclarée hors du mode autonome sous une raison nommée. Ce qui est annoncé disponible doit l'être.
#[test]
fn une_scene_animee_ne_peut_pas_etre_annoncee_autonome_puis_figee() {
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
            "sans son animation, la scène autonome ne doit pas être annoncée"
        );
        assert!(
            result["unsupported"]
                .as_array()
                .expect("unsupported")
                .contains(&json!("autonomous-scene-animated")),
            "le mode refusé se compte par son nom : {}",
            result["unsupported"]
        );
    }
}

// L'autre bout : une scène sans animation garde son mode autonome, et rien n'est compté.
#[test]
fn une_scene_sans_animation_garde_sa_scene_autonome() {
    let (result, scene) = compile_scene("figee", false);
    assert_eq!(result["autonomousScene"], json!("scene.gltf"));
    assert!(scene.is_some(), "le glTF autonome est écrit");
    assert!(
        !result["unsupported"]
            .as_array()
            .expect("unsupported")
            .contains(&json!("autonomous-scene-animated")),
        "rien à compter quand rien n'est perdu"
    );
}
