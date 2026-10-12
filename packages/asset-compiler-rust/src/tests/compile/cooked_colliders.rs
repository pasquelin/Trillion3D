//! Every mesh collider a cook publishes in `physics.json` measures at or under its published
//! tolerance, on the engine's test scenes and on a family of generated scenes of thin closed
//! parts (`tests/thin_shapes.rs`), each cooked by the test.
use super::cooked_scene::{cook_fixture, cook_scene, CookedScene, ENGINE_SCENES};
use super::*;
use crate::tests::thin_shapes::ThinShapes;

/// The mesh colliders of `scene` with a tolerance (zero tolerances, no level 1, measure float
/// noise and are skipped): how many, and one line for each measured over its tolerance. Removes
/// the scene's folder.
fn colliders_over(scene: CookedScene, name: &str) -> (usize, Vec<String>) {
    let physics = scene.physics();
    let _ = fs::remove_dir_all(&scene.root);
    let (mut checked, mut over) = (0, Vec::new());
    for c in physics["colliders"].as_array().expect("colliders") {
        let (t, h) = (
            c["tolerance"].as_f64().expect("tolerance"),
            c["hausdorff"].as_f64().expect("hausdorff"),
        );
        if c["kind"] == "mesh" && t > 0.0 {
            checked += 1;
            if h > t {
                over.push(format!("{name}: {h} over {t}"));
            }
        }
    }
    (checked, over)
}

#[test]
fn cooked_colliders_hold_their_published_tolerance() {
    let mut scenes: Vec<(String, CookedScene)> = ENGINE_SCENES
        .iter()
        .map(|&(folder, gltf, tag)| {
            let scene = cook_fixture(folder, gltf, tag, "qem-endpoints");
            (folder.to_string(), scene)
        })
        .collect();
    for (rank, case) in ThinShapes::family().iter().enumerate() {
        let tag = format!("thin-colliders-{rank}");
        let (gltf, bin) = case.document(&tag);
        let scene = cook_scene(&tag, gltf, bin, &[], "qem-endpoints");
        scenes.push((format!("{case:?}"), scene));
    }
    let (mut checked, mut over) = (0, Vec::new());
    for (name, scene) in scenes {
        let (count, defects) = colliders_over(scene, &name);
        assert!(count > 0, "{name}: no cooked collider with a tolerance");
        checked += count;
        over.extend(defects);
    }
    assert!(checked > 0, "no cooked collider with a tolerance");
    assert!(over.is_empty(), "{over:#?}");
}
