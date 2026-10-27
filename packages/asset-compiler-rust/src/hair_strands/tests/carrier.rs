//! A groom crossing a scene whole and leaving it, and the scenes that refuse one.
use super::{flat, groom, row};
use crate::hair_strands::carrier::{extension, take};
use crate::hair_strands::description::{Description, Widths};
use crate::plugins::scene::convert::Bin;
use serde_json::{json, Value};

// Behaviour: arrays that do not fit one another are refused where the groom enters the compiler.
#[test]
fn a_groom_whose_arrays_do_not_fit_is_refused_when_taken() {
    let (mut too_few, bin) = scene_with(&groom(&[3, 3], &row(0.0, 5)));
    assert!(take(&mut too_few, &bin).is_err(), "too few points");
    let mut widths = groom(&[2], &row(0.0, 2));
    widths.widths = Widths::Strand(vec![0.1, 0.2]);
    let (mut too_many, bin) = scene_with(&widths);
    assert!(take(&mut too_many, &bin).is_err(), "a width too many");
}

/// The glTF document of a scene of two nodes, the second carrying `description`.
fn scene_with(description: &Description) -> (Value, Vec<u8>) {
    let mut bin = Bin {
        bytes: Vec::new(),
        views: Vec::new(),
    };
    let mut accessors = Vec::new();
    let cited = extension(description, &mut bin, &mut accessors);
    let gltf = json!({
        "asset": {"version": "2.0"},
        "nodes": [{"name": "a"}, {"name": "b", "extensions": cited}],
        "accessors": accessors,
        "bufferViews": bin.views,
        "buffers": [{"byteLength": bin.bytes.len()}],
    });
    (gltf, bin.bytes)
}

// Behaviour: a groom written into a scene's binary is read back whole and leaves the scene, its node
// keeping the extensions it had besides; widths of each point, colours, group numbers (negative ones
// too) and names cross as they are.
#[test]
fn a_groom_crosses_the_scene_whole_and_leaves_it() {
    let sent = Description {
        positions: flat(&row(0.0, 5)),
        counts: vec![2, 3],
        widths: Widths::Vertex(vec![0.1, 0.2, 0.3, 0.4, 0.5]),
        root_uvs: vec![0.1, 0.2, 0.3, 0.4],
        colors: vec![0.5; 15],
        roughness: vec![0.25; 5],
        group_ids: vec![-3, 4],
        names: vec!["a".into(), "b".into()],
        group_names: vec![1, 0],
        groom_width: Some(0.5),
    };
    let (mut gltf, bin) = scene_with(&sent);
    gltf["nodes"][1]["extensions"]["KHR_lights_punctual"] = json!({"light": 0});
    let taken = take(&mut gltf, &bin).expect("take");
    assert_eq!(taken.len(), 1);
    assert_eq!(taken[0].node, 1);
    assert_eq!(taken[0].description, sent);
    assert_eq!(
        gltf["nodes"][1]["extensions"],
        json!({"KHR_lights_punctual": {"light": 0}})
    );
    let (mut alone, bin) = scene_with(&groom(&[2], &row(0.0, 2)));
    assert!(crate::hair_strands::carries(&alone["nodes"][1]));
    let taken = take(&mut alone, &bin).expect("take");
    assert_eq!(taken[0].description.groom_width, Some(0.02));
    assert!(
        alone["nodes"][1].get("extensions").is_none(),
        "no extensions left, none kept"
    );
    assert!(
        take(&mut alone, &bin).expect("again").is_empty(),
        "nothing left to take"
    );
}

// Behaviour: the extras of a node are never taken for a groom, only the vendor's extension is: a glTF
// a user wrote with `extras.hairStrands` is left as it is.
#[test]
fn a_users_extras_are_not_a_groom() {
    let (mut gltf, bin) = scene_with(&groom(&[2], &row(0.0, 2)));
    gltf["nodes"][0]["extras"] = json!({"hairStrands": {"counts": 0, "positions": 1}});
    let before = gltf["nodes"][0].clone();
    let taken = take(&mut gltf, &bin).expect("take");
    assert_eq!(taken.len(), 1);
    assert_eq!(taken[0].node, 1);
    assert_eq!(gltf["nodes"][0], before);
    assert!(!crate::hair_strands::carries(&gltf["nodes"][0]));
}

// Behaviour: an array cited as another shape than it is refuses the scene instead of being read as
// something else.
#[test]
fn an_array_that_is_not_what_it_is_cited_as_is_refused() {
    let (mut gltf, bin) = scene_with(&groom(&[2], &row(0.0, 2)));
    let positions = gltf["nodes"][1]["extensions"]["TRILLION3D_hair_strands"]["positions"]
        .as_u64()
        .expect("accessor") as usize;
    gltf["accessors"][positions]["type"] = json!("VEC2");
    assert!(take(&mut gltf, &bin).is_err());
}
